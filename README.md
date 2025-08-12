# SMF Voice Agent

A semi-autonomous conversational AI system designed for ALS patients using eye gaze technology. This system enables natural communication through continuous speech recognition, intelligent response generation, and eye gaze-controlled interface.

## Features

- **Continuous Voice Recording** with Silero VAD (Voice Activity Detection)
- **Real-time Transcription** using ElevenLabs Scribe
- **Intelligent Response Generation** with OpenAI GPT-4
- **Natural Voice Synthesis** via ElevenLabs TTS
- **Local Knowledge Base** with RAG (Retrieval-Augmented Generation)
- **Eye Gaze Interface** with visual feedback and customizable hover duration
- **Context-Aware Conversations** with weighted chat history
- **Internet Search Integration** for current information

## Prerequisites

- Node.js 16+ and npm
- Python 3.8+ with pip
- API Keys:
  - OpenAI API key
  - ElevenLabs API key 

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/SMF-Communication-Assistant.git
cd SMF-Communication-Assistant
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Install Python dependencies for VAD:
```bash
pip install torch torchaudio sounddevice numpy
```

4. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

5. Edit `.env` and add your API keys:
```env
OPENAI_API_KEY=your_openai_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

6. Create required directories:
```bash
mkdir -p data/vector_store data/kb data/recordings data/archives
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to:
```
http://localhost:5050
```

3. Grant microphone permissions when prompted

4. Start communicating:
   - Click "Start Recording" or let VAD detect speech automatically
   - Speak naturally - the system will detect when you start and stop talking
   - Choose from three AI-generated responses using eye gaze or mouse
   - Or type messages directly in the text input

## Eye Gaze Controls

The interface is optimized for eye gaze control:

- **Large Buttons**: All interactive elements are sized for easy targeting
- **Hover Selection**: Look at an option for 3 seconds to select it
- **Visual Feedback**: Progress indicator shows selection progress
- **Customizable Duration**: Adjust hover time in settings (1-5 seconds)

## Configuration

### Settings Menu

Access settings by clicking the gear icon:

- **Voice Settings**: Choose TTS voice and speech rate
- **Eye Gaze Settings**: Adjust hover duration and visual feedback
- **LLM Settings**: Configure temperature and max tokens
- **Speaker Management**: Add, edit, and enroll speaker voices

### Knowledge Base

- Supported formats: `.txt`, `.pdf`, `.docx`, `.json`
- Files are automatically indexed and available to the AI
- Updates are detected and processed in real-time
- Create memories in the app

## Architecture

### Server Components

- **Express.js** server with Socket.io for real-time communication
- **Services**:
  - `audioRecorder.js`: Continuous recording with Silero VAD
  - `transcription.js`: Speech-to-text with ElevenLabs/OpenAI
  - `llm.js`: Response generation with context management
  - `tts.js`: Text-to-speech synthesis
  - `rag.js`: Local knowledge base with vector search
  - `internetSearch.js`: Web search integration

### Client Components

- **Responsive UI** with dark theme optimized for eye strain
- **Real-time updates** via WebSocket connection
- **Eye gaze controls** with customizable parameters
- **Progressive enhancement** for accessibility

## Development

### Running in Development Mode

```bash
npm run dev
```

### Project Structure

```
├── server/
│   ├── index.js          # Main server file
│   ├── services/         # Core services
│   ├── routes/           # API endpoints
│   ├── utils/            # Helper utilities
│   └── config/           # Configuration
├── client/
│   ├── index.html        # Main UI
│   ├── styles.css        # Styling
│   └── js/               # Client-side logic
└── data/                 # User data directories
```

## Troubleshooting

### Common Issues

1. **Microphone not working**:
   - Check browser permissions
   - Ensure no other application is using the microphone

2. **VAD not detecting speech**:
   - Adjust `VAD_THRESHOLD` in `.env` (lower = more sensitive)
   - Check microphone input levels

3. **Eye gaze not working**:
   - Ensure visual feedback is enabled in settings
   - Try adjusting hover duration
   - Check if JavaScript is enabled

### Logs

Check `logs/app.log` for detailed debugging information.

## Privacy & Security

- All conversations are stored locally
- API keys are never sent to the client
- Automatic archiving of old conversations (30+ days)
- Speaker embeddings stored securely in local database

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Silero Team for VAD models
- OpenAI for GPT-4
- ElevenLabs for TTS
- The ALS community for inspiration

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing documentation
- Review logs for error messages

---

Built with ❤️ for the ALS community