#!/usr/bin/env python3
"""
Silero VAD integration for continuous speech detection
"""

import sys
import argparse
import base64
import numpy as np
import torch
import torchaudio
import sounddevice as sd
from queue import Queue
import threading
import time

# Load Silero VAD
torch.set_num_threads(1)

model, utils = torch.hub.load(
    repo_or_dir='snakers4/silero-vad',
    model='silero_vad',
    force_reload=False,
    onnx=False
)

(get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks) = utils

class ContinuousVAD:
    def __init__(self, threshold=0.5, min_duration=250, sample_rate=16000):
        self.threshold = threshold
        self.min_duration = min_duration
        self.sample_rate = sample_rate
        self.model = model
        self.vad_iterator = VADIterator(model, threshold=threshold)
        
        self.audio_queue = Queue()
        self.is_recording = False
        self.is_speech = False
        self.speech_buffer = []
        self.silence_counter = 0
        self.speech_start_time = None
        
    def audio_callback(self, indata, frames, time, status):
        """Callback for continuous audio recording"""
        if status:
            print(f"ERROR: {status}", file=sys.stderr)
        
        # Add audio to processing queue
        self.audio_queue.put(indata.copy())
    
    def process_audio(self):
        """Process audio chunks for VAD"""
        while self.is_recording:
            try:
                # Get audio chunk from queue
                audio_chunk = self.audio_queue.get(timeout=0.1)
                
                # Convert to tensor
                audio_tensor = torch.from_numpy(audio_chunk.flatten()).float()
                
                # Run VAD
                speech_dict = self.vad_iterator(audio_tensor, return_seconds=False)
                
                if speech_dict:
                    if 'start' in speech_dict:
                        self.handle_speech_start()
                    
                    # Add to speech buffer
                    self.speech_buffer.append(audio_chunk)
                    self.silence_counter = 0
                    
                else:
                    # No speech detected
                    if self.is_speech:
                        self.silence_counter += 1
                        self.speech_buffer.append(audio_chunk)
                        
                        # Check if silence is long enough to end speech
                        if self.silence_counter > 10:  # ~100ms of silence
                            self.handle_speech_end()
                
            except:
                continue
    
    def handle_speech_start(self):
        """Handle start of speech"""
        if not self.is_speech:
            self.is_speech = True
            self.speech_start_time = time.time()
            self.speech_buffer = []
            print("SPEECH_START", flush=True)
    
    def handle_speech_end(self):
        """Handle end of speech"""
        if self.is_speech:
            self.is_speech = False
            duration = (time.time() - self.speech_start_time) * 1000  # ms
            
            print("SPEECH_END", flush=True)
            
            # Check minimum duration
            if duration >= self.min_duration and self.speech_buffer:
                # Combine audio chunks
                audio_data = np.concatenate(self.speech_buffer)
                
                # Convert to WAV format
                audio_tensor = torch.from_numpy(audio_data).float()
                
                # Encode as base64 for transmission
                audio_bytes = (audio_tensor.numpy() * 32767).astype(np.int16).tobytes()
                audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                
                print(f"AUDIO:{audio_base64}", flush=True)
            
            # Reset buffer
            self.speech_buffer = []
            self.silence_counter = 0
    
    def start(self):
        """Start continuous recording with VAD"""
        self.is_recording = True
        
        # Start processing thread
        process_thread = threading.Thread(target=self.process_audio)
        process_thread.start()
        
        # Start recording
        with sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            callback=self.audio_callback,
            blocksize=int(self.sample_rate * 0.01),  # 10ms chunks
            dtype=np.float32
        ):
            print("Recording started", file=sys.stderr)
            
            try:
                while self.is_recording:
                    time.sleep(0.1)
            except KeyboardInterrupt:
                self.stop()
        
        process_thread.join()
    
    def stop(self):
        """Stop recording"""
        self.is_recording = False
        
        # Process any remaining speech
        if self.is_speech:
            self.handle_speech_end()
        
        print("Recording stopped", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description='Silero VAD for continuous recording')
    parser.add_argument('--threshold', type=float, default=0.5,
                       help='VAD threshold (0-1)')
    parser.add_argument('--min-duration', type=int, default=250,
                       help='Minimum speech duration in ms')
    parser.add_argument('--sample-rate', type=int, default=16000,
                       help='Audio sample rate')
    
    args = parser.parse_args()
    
    # Create and start VAD
    vad = ContinuousVAD(
        threshold=args.threshold,
        min_duration=args.min_duration,
        sample_rate=args.sample_rate
    )
    
    try:
        vad.start()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()