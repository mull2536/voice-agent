const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up SMF Communication Assistant...\n');

// Create required directories
const directories = [
    'data',
    'data/vector_store',
    'data/kb',
    'data/recordings',
    'data/logs'
];

directories.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
    } else {
        console.log(`📁 Directory exists: ${dir}`);
    }
});

// Create .env file from example if it doesn't exist
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('\n✅ Created .env file from .env.example');
    console.log('⚠️  Please edit .env and add your API keys!');
} else if (fs.existsSync(envPath)) {
    console.log('\n📄 .env file already exists');
} else {
    console.log('\n❌ .env.example not found!');
}

// Initialize JSON data files
const dataFiles = {
    'data/conversations.json': '[]',
    'data/people.json': JSON.stringify([
        { id: 'family', name: 'Family Member', notes: 'General family conversations', addedAt: new Date().toISOString() },
        { id: 'caregiver', name: 'Caregiver', notes: 'Daily care and assistance', addedAt: new Date().toISOString() },
        { id: 'doctor', name: 'Doctor', notes: 'Medical discussions', addedAt: new Date().toISOString() },
        { id: 'friend', name: 'Friend', notes: 'Social conversations', addedAt: new Date().toISOString() },
        { id: 'other', name: 'Other', notes: 'Anyone else', addedAt: new Date().toISOString() }
    ], null, 2),
    'data/settings.json': JSON.stringify({
        llm: {
            temperature: 0.7,
            maxTokens: 500
        },
        tts: {
            speechRate: 1.0
        },
        eyeGaze: {
            hoverDuration: 3000,
            visualFeedback: true
        }
    }, null, 2)
};

Object.entries(dataFiles).forEach(([filePath, content]) => {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, content);
        console.log(`✅ Created ${filePath}`);
    } else {
        console.log(`📄 ${filePath} already exists`);
    }
});

console.log('\n✨ Setup complete!');
console.log('\nNext steps:');
console.log('1. Edit .env file with your API keys');
console.log('2. Install Python dependencies: pip install -r requirements.txt');
console.log('3. Start the server: npm start');
console.log('\nFor more information, see README.md');