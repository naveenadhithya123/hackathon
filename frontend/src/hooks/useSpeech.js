import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../services/api.js";

export function useSpeech() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const transcriptRef = useRef("");
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const recognitionRef = useRef(null);
  const utteranceRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingModeRef = useRef("idle");

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      recorderRef.current?.stop?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop?.();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function monitorAudioLevel() {
    if (!analyserRef.current) {
      return;
    }

    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);

    let total = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      total += centered * centered;
    }

    const rms = Math.sqrt(total / data.length);
    setAudioLevel(Math.min(1, rms * 5));
    rafRef.current = requestAnimationFrame(monitorAudioLevel);
  }

  async function getAudioStream() {
    if (streamRef.current) {
      return streamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    return stream;
  }

  async function beginAudioMeter(stream) {
    const activeStream = stream || await getAudioStream();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    try {
      const audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }

      const source = audioContext.createMediaStreamSource(activeStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      monitorAudioLevel();
    } catch {
      audioContextRef.current = null;
      analyserRef.current = null;
      setAudioLevel(0);
    }
  }

  function stopAudioMeter() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    setAudioLevel(0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  async function startRecognitionRecording(SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        finalText += `${event.results[index][0].transcript} `;
      }
      transcriptRef.current = finalText.trim();
      setTranscript(transcriptRef.current);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      stopAudioMeter();
      recognitionRef.current = null;
      recordingModeRef.current = "idle";
    };

    recognition.onend = () => {
      setIsRecording(false);
      stopAudioMeter();
      recognitionRef.current = null;
      recordingModeRef.current = "idle";
    };

    recognitionRef.current = recognition;
    recognition.start();
    recordingModeRef.current = "recognition";
    setIsRecording(true);
  }

  function pickRecorderMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    return candidates.find((candidate) => window.MediaRecorder?.isTypeSupported?.(candidate)) || "";
  }

  async function startRecorderRecording() {
    if (!window.MediaRecorder) {
      throw new Error("Audio recording is not supported in this browser.");
    }

    const stream = await getAudioStream();
    await beginAudioMeter(stream);

    chunksRef.current = [];
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      setIsRecording(false);
      stopAudioMeter();
    };

    recorderRef.current = recorder;
    recorder.start();
    recordingModeRef.current = "recorder";
    setIsRecording(true);
  }

  async function startRecording() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    setTranscript("");
    transcriptRef.current = "";

    if (SpeechRecognition) {
      try {
        await startRecognitionRecording(SpeechRecognition);
        return;
      } catch (_recognitionError) {
        // Fall through to recorder transcription when browser recognition is unavailable.
      }
    }

    if (window.MediaRecorder || navigator.mediaDevices?.getUserMedia) {
      await startRecorderRecording();
      return;
    }

    throw new Error("Voice input is not supported in this browser.");
  }

  async function stopRecording() {
    if (recordingModeRef.current === "recorder" && recorderRef.current) {
      const recorder = recorderRef.current;

      return new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          setIsRecording(false);
          stopAudioMeter();
          recorderRef.current = null;
          recordingModeRef.current = "idle";

          if (!chunksRef.current.length) {
            chunksRef.current = [];
            reject(new Error("No audio was captured. Please try again."));
            return;
          }

          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          chunksRef.current = [];

          try {
            const result = await transcribeAudio(blob);
            transcriptRef.current = String(result.text || "").trim();
            setTranscript(transcriptRef.current);
            resolve(transcriptRef.current);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("Voice transcription failed on this phone."),
            );
          }
        };

        recorder.stop();
      });
    }

    if (!recognitionRef.current) {
      return transcriptRef.current.trim();
    }

    return new Promise((resolve) => {
      const finalText = () => {
        resolve(transcriptRef.current.trim());
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
        stopAudioMeter();
        recognitionRef.current = null;
        recordingModeRef.current = "idle";
        finalText();
      };

      recognitionRef.current.stop();
    });
  }

  async function speak(text) {
    if (!text) {
      return;
    }

    const normalized = text.trim();

    if (isSpeaking && speakingText === normalized) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
      return;
    }

    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
    };
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    setSpeakingText(normalized);
    window.speechSynthesis?.speak(utterance);
  }

  return {
    isRecording,
    audioLevel,
    transcript,
    isSpeaking,
    speakingText,
    startRecording,
    stopRecording,
    speak,
  };
}
