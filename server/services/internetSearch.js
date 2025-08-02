const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class InternetSearchService {
  constructor() {
    this.apiKey = process.env.SEARCH_ENGINE_API_KEY;
    this.searchEngineId = process.env.SEARCH_ENGINE_ID;
    this.autoSearchEnabled = process.env.AUTO_SEARCH_ENABLED === 'true';
  }

  async search(query, numResults = 5) {
    if (!this.autoSearchEnabled) {
      return [];
    }

    try {
      // Using Google Custom Search API
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: this.apiKey,
          cx: this.searchEngineId,
          q: query,
          num: numResults
        }
      });

      const results = response.data.items || [];
      
      // Format results
      const formattedResults = results.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink
      }));

      logger.info(`Internet search completed: ${query} (${formattedResults.length} results)`);
      return formattedResults;

    } catch (error) {
      logger.error('Internet search failed:', error);
      
      // Fallback to DuckDuckGo if Google fails
      return this.fallbackSearch(query, numResults);
    }
  }

  async fallbackSearch(query, numResults) {
    try {
      // Using DuckDuckGo HTML search as fallback
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const results = [];

      $('.result').each((index, element) => {
        if (index >= numResults) return false;

        const title = $(element).find('.result__title').text().trim();
        const link = $(element).find('.result__url').attr('href');
        const snippet = $(element).find('.result__snippet').text().trim();

        if (title && link) {
          results.push({
            title,
            link,
            snippet,
            displayLink: new URL(link).hostname
          });
        }
      });

      logger.info(`Fallback search completed: ${query} (${results.length} results)`);
      return results;

    } catch (error) {
      logger.error('Fallback search also failed:', error);
      return [];
    }
  }

  async extractContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Remove script and style elements
      $('script, style').remove();
      
      // Extract main content
      let content = '';
      const selectors = ['main', 'article', '.content', '#content', 'body'];
      
      for (const selector of selectors) {
        const element = $(selector).first();
        if (element.length) {
          content = element.text().trim();
          break;
        }
      }

      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();
      
      // Limit content length
      if (content.length > 2000) {
        content = content.substring(0, 2000) + '...';
      }

      return content;

    } catch (error) {
      logger.error(`Failed to extract content from ${url}:`, error);
      return null;
    }
  }
}

let searchService = null;

async function searchInternet(query, numResults = 5) {
  if (!searchService) {
    searchService = new InternetSearchService();
  }
  
  return searchService.search(query, numResults);
}

module.exports = {
  InternetSearchService,
  searchInternet
};