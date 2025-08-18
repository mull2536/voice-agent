const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const pdfParse = require('pdf-parse');

class InternetSearchService {
  constructor() {
    this.maxContentSize = 10 * 1024 * 1024; // 10MB max
    this.timeout = 10000; // 10 seconds
    this.userAgent = 'Mozilla/5.0 (compatible; ALS-Voice-Assistant/1.0; +https://github.com/yourusername/project)';
    
    // Blacklisted patterns
    this.blacklistPatterns = [
      /^https?:\/\/[^\/]+\/?$/i, // Root domains only
      /twitter\.com|x\.com/i,
      /facebook\.com/i,
      /instagram\.com/i,
      /amazon\.[a-z]+\/s\?/i, // Amazon search
      /google\.[a-z]+\/search/i, // Google search
      /youtube\.com\/results/i, // YouTube search
      /github\.com\/?$/i, // GitHub root
      /linkedin\.com\/feed/i,
    ];

    // Content type handlers
    this.extractors = {
      article: this.extractArticle.bind(this),
      documentation: this.extractDocumentation.bind(this),
      pdf: this.extractPDF.bind(this),
      generic: this.extractGeneric.bind(this)
    };
  }

  /**
   * Main entry point for fetching and extracting web content
   */
  async fetchAndExtract(url) {
    try {
      // Validate URL
      const validation = this.validateUrl(url);
      if (!validation.valid) {
        throw new Error(validation.message);
      }

      logger.info(`Fetching content from: ${url}`);

      // Check if it's a PDF
      if (url.toLowerCase().endsWith('.pdf')) {
        return await this.extractPDF(url);
      }

      // Fetch HTML content
      const response = await axios.get(url, {
        timeout: this.timeout,
        maxContentLength: this.maxContentSize,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        responseType: 'text'
      });

      // Load HTML with cheerio
      const $ = cheerio.load(response.data);
      
      // Detect content type
      const contentType = this.detectContentType($, url);
      logger.info(`Detected content type: ${contentType} for ${url}`);

      // Extract content using appropriate method
      const extractor = this.extractors[contentType] || this.extractors.generic;
      const result = await extractor($, url, response.data);

      // Add common metadata
      result.url = url;
      result.fetchedAt = new Date().toISOString();
      result.contentType = contentType;

      // Validate extracted content
      if (!result.content || result.content.length < 100) {
        throw new Error('Insufficient content extracted from the page');
      }

      logger.info(`Successfully extracted ${result.content.length} characters from ${url}`);
      return result;

    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Timeout: Page took longer than ${this.timeout/1000} seconds to load`);
      } else if (error.response?.status === 404) {
        throw new Error('Page not found (404)');
      } else if (error.response?.status === 403) {
        throw new Error('Access forbidden (403) - The website blocks automated access');
      } else if (error.response?.status === 401) {
        throw new Error('Authentication required - Cannot index pages behind login');
      } else if (error.message.includes('maxContentLength')) {
        throw new Error('Page content too large (over 10MB)');
      }
      
      logger.error(`Failed to fetch/extract from ${url}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate URL before processing
   */
  validateUrl(url) {
    // Check URL format
    try {
      const urlObj = new URL(url);
      
      // Must be http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { valid: false, message: 'Only HTTP and HTTPS URLs are supported' };
      }
    } catch (error) {
      return { valid: false, message: 'Invalid URL format' };
    }

    // Check against blacklist patterns
    for (const pattern of this.blacklistPatterns) {
      if (pattern.test(url)) {
        if (url.match(/^https?:\/\/[^\/]+\/?$/i)) {
          return { 
            valid: false, 
            message: 'Please provide a specific page URL, not just the domain. For example: https://example.com/specific-article' 
          };
        } else if (url.match(/github\.com\/?$/i)) {
          return { 
            valid: false, 
            message: 'Please provide a specific file or repository README, not the GitHub homepage' 
          };
        } else if (url.match(/twitter|facebook|instagram|linkedin/i)) {
          return { 
            valid: false, 
            message: 'Social media feeds and profiles cannot be indexed. Please provide specific article or documentation URLs instead.' 
          };
        } else if (url.match(/\/search|\/results/i)) {
          return { 
            valid: false, 
            message: 'Search result pages cannot be indexed. Please provide a direct link to the specific content.' 
          };
        }
        return { valid: false, message: 'This type of URL is not supported for indexing' };
      }
    }

    return { valid: true };
  }

  /**
   * Detect the type of content based on HTML structure and URL
   */
  detectContentType($, url) {
    // Check for documentation sites
    if (url.includes('docs.') || url.includes('/docs/') || 
        url.includes('documentation') || url.includes('/api/') ||
        $('pre code').length > 3) {
      return 'documentation';
    }

    // Check for article/blog indicators
    if ($('article').length > 0 || 
        $('.post-content, .entry-content, .article-content').length > 0 ||
        $('meta[property="article:published_time"]').length > 0 ||
        url.includes('/blog/') || url.includes('/posts/') || 
        url.includes('medium.com') || url.includes('/article/')) {
      return 'article';
    }

    // Check for PDF
    if (url.toLowerCase().endsWith('.pdf')) {
      return 'pdf';
    }

    return 'generic';
  }

  /**
   * Extract article/blog content
   */
  async extractArticle($, url) {
    const result = {
      title: '',
      content: '',
      metadata: {}
    };

    // Extract title
    result.title = this.extractTitle($);

    // Extract metadata
    result.metadata.author = $('meta[name="author"]').attr('content') || 
                            $('meta[property="article:author"]').attr('content') ||
                            $('.author-name, .by-author, .author').first().text().trim();
    
    result.metadata.publishDate = $('meta[property="article:published_time"]').attr('content') ||
                                  $('time[datetime]').first().attr('datetime') ||
                                  $('.publish-date, .post-date').first().text().trim();

    result.metadata.description = $('meta[name="description"]').attr('content') ||
                                  $('meta[property="og:description"]').attr('content');

    // Extract main content - try multiple selectors
    const contentSelectors = [
      'article',
      '[role="main"]',
      '.post-content',
      '.entry-content', 
      '.article-content',
      '.content-body',
      '#content',
      'main',
      '.markdown-body'
    ];

    let mainContent = '';
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().length > 200) {
        // Remove unwanted elements
        element.find('script, style, nav, header, footer, .comments, .sidebar, .advertisement').remove();
        
        // Extract text with structure
        mainContent = this.extractStructuredText(element, $);
        if (mainContent.length > 200) break;
      }
    }

    // Fallback to body if no content found
    if (!mainContent) {
      $('body').find('script, style, nav, header, footer, iframe, .comments').remove();
      mainContent = this.extractStructuredText($('body'), $);
    }

    result.content = mainContent;
    return result;
  }

  /**
   * Extract documentation content
   */
  async extractDocumentation($, url) {
    const result = {
      title: '',
      content: '',
      metadata: {}
    };

    // Extract title
    result.title = this.extractTitle($);

    // Documentation-specific metadata
    result.metadata.version = $('meta[name="version"]').attr('content') ||
                              $('.version').first().text().trim();
    
    result.metadata.category = $('.breadcrumb').text().trim() ||
                               $('nav[aria-label="breadcrumb"]').text().trim();

    // Extract main content with code blocks preserved
    const contentSelectors = [
      '.documentation-content',
      '.doc-content',
      '[role="main"]',
      '.markdown-body',
      '#content',
      'article',
      'main'
    ];

    let mainContent = '';
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        // Remove navigation and other non-content elements
        element.find('nav, .sidebar, .toc, .navigation').remove();
        
        // Extract with code blocks
        mainContent = this.extractDocumentationText(element, $);
        if (mainContent.length > 200) break;
      }
    }

    result.content = mainContent || this.extractDocumentationText($('body'), $);
    return result;
  }

  /**
   * Extract PDF content
   */
  async extractPDF(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: this.timeout,
        maxContentLength: 10 * 1024 * 1024, // 10MB max for PDFs
        headers: {
          'User-Agent': this.userAgent
        }
      });

      const pdfBuffer = Buffer.from(response.data);
      const data = await pdfParse(pdfBuffer);

      return {
        title: data.info?.Title || url.split('/').pop().replace('.pdf', ''),
        content: data.text,
        metadata: {
          pages: data.numpages,
          info: data.info
        }
      };
    } catch (error) {
      logger.error(`Failed to extract PDF from ${url}:`, error);
      throw new Error(`Failed to extract PDF content: ${error.message}`);
    }
  }

  /**
   * Generic content extraction
   */
  async extractGeneric($, url) {
    const result = {
      title: '',
      content: '',
      metadata: {}
    };

    // Extract title
    result.title = this.extractTitle($);

    // Basic metadata
    result.metadata.description = $('meta[name="description"]').attr('content') ||
                                  $('meta[property="og:description"]').attr('content');

    // Remove non-content elements
    $('script, style, nav, header, footer, aside, .sidebar, .advertisement, .cookie-notice').remove();

    // Try to find main content area
    const mainSelectors = ['main', '[role="main"]', '#main', '.main-content', '#content', '.content'];
    
    let mainContent = '';
    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().length > 200) {
        mainContent = this.extractStructuredText(element, $);
        break;
      }
    }

    // Fallback to body
    if (!mainContent) {
      mainContent = this.extractStructuredText($('body'), $);
    }

    result.content = mainContent;
    return result;
  }

  /**
   * Extract title from page
   */
  extractTitle($) {
    return $('meta[property="og:title"]').attr('content') ||
           $('title').text().trim() ||
           $('h1').first().text().trim() ||
           'Untitled Page';
  }

  /**
   * Extract structured text preserving headers and paragraphs
   */
  extractStructuredText(element, $) {
    let content = [];
    
    element.find('h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote').each((i, el) => {
      const $el = $(el);
      const tagName = el.tagName.toLowerCase();
      let text = $el.clone().children().remove().end().text().trim();
      
      if (text) {
        if (tagName.startsWith('h')) {
          content.push(`\n${'#'.repeat(parseInt(tagName[1]))} ${text}\n`);
        } else if (tagName === 'li') {
          content.push(`• ${text}`);
        } else if (tagName === 'blockquote') {
          content.push(`> ${text}`);
        } else {
          content.push(text);
        }
      }
    });

    return content.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Extract documentation text with code blocks preserved
   */
  extractDocumentationText(element, $) {
    let content = [];
    
    element.find('h1, h2, h3, h4, h5, h6, p, pre, code, li, blockquote').each((i, el) => {
      const $el = $(el);
      const tagName = el.tagName.toLowerCase();
      
      if (tagName === 'pre' || (tagName === 'code' && $el.parent().prop('tagName') !== 'PRE')) {
        // Preserve code blocks
        const code = $el.text().trim();
        if (code) {
          if (tagName === 'pre') {
            content.push(`\n\`\`\`\n${code}\n\`\`\`\n`);
          } else {
            content.push(`\`${code}\``);
          }
        }
      } else if (tagName.startsWith('h')) {
        const text = $el.text().trim();
        if (text) {
          content.push(`\n${'#'.repeat(parseInt(tagName[1]))} ${text}\n`);
        }
      } else if (tagName === 'li') {
        const text = $el.clone().children('pre, code').remove().end().text().trim();
        if (text) {
          content.push(`• ${text}`);
        }
      } else if (tagName === 'p' || tagName === 'blockquote') {
        const text = $el.clone().children('pre').remove().end().text().trim();
        if (text) {
          content.push(tagName === 'blockquote' ? `> ${text}` : text);
        }
      }
    });

    return content.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Test if a URL is reachable
   */
  async testUrl(url) {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        headers: {
          'User-Agent': this.userAgent
        }
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
let searchService = null;

function getInternetSearchService() {
  if (!searchService) {
    searchService = new InternetSearchService();
  }
  return searchService;
}

module.exports = {
  InternetSearchService,
  getInternetSearchService
};