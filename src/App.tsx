import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Activity, 
  AlertCircle, 
  ArrowRight, 
  ChevronRight, 
  ClipboardList, 
  Dna, 
  FileText, 
  Heart, 
  Info, 
  LayoutDashboard, 
  Loader2, 
  MapPin, 
  Pill, 
  Plus, 
  ShieldAlert, 
  Stethoscope, 
  Thermometer, 
  TrendingUp, 
  Upload, 
  User, 
  CheckCircle2,
  Brain,
  MessageSquareHeart,
  ExternalLink,
  ChevronDown,
  Mic,
  Volume2,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { cn } from './lib/utils';
import { analyzeMedicalData, generateSpeech, generateVoiceResponseStream, classifyIntent, hasGeminiApiKey, transcribeVoiceInput } from './services/geminiService';
import { 
  AnalysisOutput, 
  PatientProfile, 
  MedicalTestResult, 
  DifferentialDiagnosis, 
  NextStep,
  Status
} from './types';

// --- Components ---

const StatusBadge = ({ status }: { status: Status }) => {
  const styles: Record<Status, string> = {
    'NORMAL': 'bg-emerald-100 text-status-success',
    'LOW': 'bg-blue-100 text-status-info',
    'HIGH': 'bg-red-100 text-status-danger',
    'CRITICAL LOW': 'bg-red-200 text-status-danger font-bold animate-pulse',
    'CRITICAL HIGH': 'bg-red-200 text-status-danger font-bold animate-pulse',
    'BORDERLINE': 'bg-amber-100 text-status-warning',
  };

  return (
    <span className={cn("px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider", styles[status])}>
      {status}
    </span>
  );
};

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white border border-border-base rounded-2xl overflow-hidden shadow-sm", className)}>
    {children}
  </div>
);


// --- Main App ---

export default function App() {
  const geminiUnavailable = !hasGeminiApiKey;
  const [view, setView] = useState<'input' | 'analysis' | 'landing' | 'voice'>('voice');
  const [loading, setLoading] = useState(false);
  const [reportText, setReportText] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [profile, setProfile] = useState<PatientProfile>({ age: '', sex: 'Male', conditions: '', medications: '', allergies: '' });
  const [analysis, setAnalysis] = useState<AnalysisOutput | null>(null);

  // Voice State
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [voiceHistory, setVoiceHistory] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [hasStartedVoiceConsultation, setHasStartedVoiceConsultation] = useState(false);
  const [voiceStage, setVoiceStage] = useState<'request_upload' | 'awaiting_upload' | 'analyzing_upload' | 'consultation'>('consultation');
  const [isPlaying, setIsPlaying] = useState(false);
  const [useRecorderMode, setUseRecorderMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += `${event.results[i][0].transcript} `;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setTranscript(interimTranscript);
        if (finalTranscript.trim()) {
          setTranscript('');
          handleVoiceInput(finalTranscript.trim());
        }
      };

      recognitionRef.current.onstart = () => {
        setVoiceError('');
      };

      recognitionRef.current.onerror = (event: any) => {
        const errorCode = event?.error as string | undefined;
        const errorMessageMap: Record<string, string> = {
          'not-allowed': 'Microphone access is blocked. Please allow microphone permission in your browser settings and try again.',
          'service-not-allowed': 'Speech recognition service is unavailable for this browser profile.',
          'audio-capture': 'No microphone was detected. Please connect a microphone and try again.',
          'network': 'Speech recognition network error. Please check your connection and retry.',
          'no-speech': 'No speech detected. Try speaking a little louder and closer to your microphone.'
        };
        setVoiceError(errorMessageMap[errorCode || ''] || 'Voice input failed. Please try again.');
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
      setUseRecorderMode(false);
      setIsSpeechSupported(true);
    } else if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window) {
      setUseRecorderMode(true);
      setIsSpeechSupported(true);
      setVoiceError('');
    } else {
      setIsSpeechSupported(false);
      setVoiceError('Voice input is unavailable in this browser. Please update your browser and ensure microphone access is enabled.');
    }
  }, []);


  const speakWithBrowserVoice = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";

    const voices = window.speechSynthesis.getVoices();
    const languageVoices = voices.filter(
      (voice) => voice.lang.toLowerCase().startsWith((navigator.language || 'en-US').split('-')[0].toLowerCase())
    );
    const softVoice = languageVoices.find((voice) =>
      /female|natural|neural|samantha|zira|karen|heera|lekha|madhur/i.test(voice.name)
    ) || languageVoices[0];
    if (softVoice) {
      utterance.voice = softVoice;
    }

    utterance.pitch = 0.92;
    utterance.rate = 0.88;
    utterance.volume = 0.9;

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.speak(utterance);
  };

  const speak = async (text: string) => {
    if (!text.trim()) {
      return;
    }

    if (hasGeminiApiKey) {
      try {
        setIsPlaying(true);
        const base64Audio = await generateSpeech(text);
        const mimeType = 'audio/wav';
        const audio = new Audio(`data:${mimeType};base64,${base64Audio}`);
        audioRef.current = audio;
        audio.onended = () => setIsPlaying(false);
        audio.onerror = () => {
          setIsPlaying(false);
          speakWithBrowserVoice(text);
        };
        await audio.play();
        return;
      } catch (error) {
        console.error('Gemini TTS failed, falling back to browser speech synthesis:', error);
        setIsPlaying(false);
      }
    }

    speakWithBrowserVoice(text);
  };

  const handleVoiceInput = async (input: string) => {
    if (!input.trim()) return;
    
    const newHistory = [...voiceHistory, { role: 'user' as const, content: input }];
    setVoiceHistory(newHistory);
    setLoading(true);

    try {
      let responseText = '';

      const classification = await classifyIntent(input);
      if (classification.intent === 'EMERGENCY') {
        responseText = "This sounds like a medical emergency. Please call 112 right now or ask someone nearby to help you. Do not wait.";
        setVoiceHistory([...newHistory, { role: 'model' as const, content: responseText }]);
      } else {
          setVoiceHistory((prev) => [...prev, { role: 'model' as const, content: '' }]);
        responseText = await generateVoiceResponseStream(
          input,
          profile,
          analysis,
          newHistory,
          (partialText) => {
            setVoiceHistory((prev) => {
              if (prev.length === 0) {
                return prev;
              }
              const updated = [...prev];
              const lastEntry = updated[updated.length - 1];
              if (lastEntry.role === 'model') {
                updated[updated.length - 1] = { role: 'model', content: partialText };
              }
              return updated;
            });
          },
          undefined
        );
      }

      await speak(responseText);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    if (view !== 'voice' || hasStartedVoiceConsultation) {
      return;
    }

    const greeting = `Hi, I'm your AI health assistant. This is a private 1-on-1 conversation room. You can share symptoms now, and upload reports anytime for deeper analysis.`;

    setVoiceHistory([{ role: 'model', content: greeting }]);
    setVoiceStage('consultation');
    setHasStartedVoiceConsultation(true);
    void speak(greeting);
  }, [view, hasStartedVoiceConsultation]);

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64Data = result.split(',')[1] || '';
        if (!base64Data) {
          reject(new Error('Failed to encode audio.'));
          return;
        }
        resolve(base64Data);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio blob.'));
      reader.readAsDataURL(blob);
    });

  const stopMediaRecorderTracks = () => {
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
    }
  };

  const handleRecorderTranscription = async () => {
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];
    if (!chunks.length) {
      setVoiceError('No speech captured. Please try speaking again.');
      return;
    }

    const mimeType = chunks[0]?.type || 'audio/webm';
    const audioBlob = new Blob(chunks, { type: mimeType });

    try {
      setLoading(true);
      setVoiceError('');
      const base64Audio = await blobToBase64(audioBlob);
      const transcriptText = await transcribeVoiceInput(base64Audio, mimeType);
      if (!transcriptText) {
        setVoiceError('I could not detect speech clearly. Please try again in a quieter environment.');
        return;
      }
      await handleVoiceInput(transcriptText);
    } catch (error) {
      console.error(error);
      setVoiceError('Could not transcribe your recording. Check microphone permissions and try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleRecorderListening = async () => {
    if (isListening) {
      mediaRecorderRef.current?.stop();
      setIsListening(false);
      return;
    }

    setTranscript('');
    setVoiceError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;
      const mimeOptions = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/ogg'
      ];
      const selectedMimeType = mimeOptions.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = selectedMimeType ? new MediaRecorder(stream, { mimeType: selectedMimeType }) : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void handleRecorderTranscription();
        stopMediaRecorderTracks();
      };
      recorder.onerror = () => {
        setVoiceError('Recording failed. Please retry.');
        setIsListening(false);
        stopMediaRecorderTracks();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
    } catch {
      setVoiceError('Could not start microphone capture. Please refresh and try again.');
      setIsListening(false);
      stopMediaRecorderTracks();
    }
  };

  const toggleListening = () => {
    if (!isSpeechSupported || !recognitionRef.current) {
      if (useRecorderMode) {
        void toggleRecorderListening();
        return;
      }
      setVoiceError('Voice recognition is unavailable in this browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setTranscript('');
      setVoiceError('');
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setVoiceError('Could not start microphone capture. Please refresh and try again.');
        setIsListening(false);
      }
    }
  };


  useEffect(() => {
    if (view !== 'voice' || loading || isPlaying || isListening) {
      return;
    }

    const timer = window.setTimeout(() => {
      toggleListening();
    }, 400);

    return () => window.clearTimeout(timer);
  }, [view, loading, isPlaying, isListening, useRecorderMode, isSpeechSupported]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      mediaRecorderRef.current?.stop?.();
      stopMediaRecorderTracks();
    };
  }, []);

  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsText(file);
    });

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) {
      return;
    }

    try {
      const isTextLikeFile =
        file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        file.name.endsWith('.csv') ||
        file.name.endsWith('.tsv') ||
        file.name.endsWith('.txt');

      if (isTextLikeFile) {
        const parsedText = (await readFileAsText(file)).trim();
        if (!parsedText) {
          setUploadMessage(`"${file.name}" is empty.`);
          return;
        }
        setReportText(parsedText);
        setUploadMessage(`Loaded ${file.name}`);
        return;
      }

      const fileDescriptor = `[UPLOADED FILE]\nName: ${file.name}\nType: ${file.type || 'Unknown'}\nSize: ${Math.round(file.size / 1024)} KB\n\nNote: OCR extraction is not enabled yet for this file type. Please paste key report values below for best results.`;
      setReportText(fileDescriptor);
      setUploadMessage(`Attached ${file.name}`);
      if (view === 'voice') {
        setVoiceStage('analyzing_upload');
        const analyzingMessage = 'Files received. I am now analyzing your reports and prescription. Please wait.';
        setVoiceHistory((prev) => [...prev, { role: 'model', content: analyzingMessage }]);
        void speak(analyzingMessage);
      }
    } catch (error) {
      console.error(error);
      setUploadMessage(`Could not read "${file.name}". Please try another file.`);
    }
  };

  // @ts-ignore - DropzoneOptions type mismatch in this environment
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 
      'image/*': ['.jpeg', '.jpg', '.png'], 
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'application/json': ['.json']
    } 
  });

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const result = await analyzeMedicalData(reportText, symptoms, profile);
      setAnalysis(result);
      setView('analysis');
      if (view === 'voice') {
        setVoiceStage('consultation');
        const consultMessage = 'Analysis is complete. I am ready to discuss your reports and prescription respectfully. You can ask me anything now.';
        setVoiceHistory((prev) => [...prev, { role: 'model', content: consultMessage }]);
        void speak(consultMessage);
      }
    } catch (error) {
      console.error(error);
      alert('Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAnalysis(null);
    setReportText('');
    setSymptoms('');
    setView('voice');
    setHasStartedVoiceConsultation(false);
  };

  return (
    <div className="flex h-screen bg-bg-base text-text-main font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      {(view === 'input' || view === 'analysis') && (
        <aside className="w-60 bg-white border-r border-border-base flex flex-col p-6 shrink-0 h-full overflow-y-auto hidden lg:flex">
          <div className="flex items-center gap-2.5 text-brand-primary font-extrabold text-xl mb-8 cursor-pointer" onClick={reset}>
            <Activity size={24} strokeWidth={3} />
            <span>MediAssist</span>
          </div>

          <div className="bg-bg-base p-4 rounded-xl mb-6">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2 block">Active Profile</span>
            <div className="text-base font-semibold text-text-bold">
              {profile.age ? `Patient Profile` : 'New Patient'}
            </div>
            <div className="text-[13px] text-text-muted mt-1 uppercase">
              {profile.age ? `${profile.age}Y • ${profile.sex}` : 'No data provided'}
            </div>
          </div>

          <div className="mb-6">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2 block">Context Details</span>
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-bold text-text-muted block">Conditions:</span>
                <p className="text-xs font-medium text-text-main">{profile.conditions || 'None listed'}</p>
              </div>
              <div>
                <span className="text-[11px] font-bold text-text-muted block">Medications:</span>
                <p className="text-xs font-medium text-text-main">{profile.medications || 'None listed'}</p>
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 bg-bg-base rounded-xl">
             <span className="text-[10px] font-bold text-text-bold mb-1 block uppercase">Disclaimer</span>
             <p className="text-[10px] leading-relaxed text-text-muted">
               Not a replacement for a licensed physician. Consult a doctor for diagnosis. Analysis for informational purposes only.
             </p>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-border-base flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            {view === 'landing' && (
              <div className="flex lg:hidden items-center gap-2 text-brand-primary font-extrabold text-lg mr-4">
                <Activity size={20} strokeWidth={3} />
                <span>MediAssist</span>
              </div>
            )}
            <h1 className="text-lg font-bold text-text-bold truncate">
              {view === 'landing' ? '' : view === 'input' ? 'Health Input Hub' : view === 'voice' ? 'Voice Consultation' : 'Medical Report Analysis'}
            </h1>
            {(view === 'analysis' || view === 'voice') && (
              <span className="bg-teal-50 text-brand-dark px-3 py-1 rounded-full text-xs font-semibold">Medical Intelligence</span>
            )}
          </div>
          
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-text-muted">
              <a href="#" className="hover:text-brand-primary transition-colors">Support</a>
              <a href="#" className="hover:text-brand-primary transition-colors">Privacy</a>
            </nav>
            {view !== 'landing' && (
              <button 
                onClick={reset}
                className="px-4 py-2 text-sm font-semibold text-text-muted hover:bg-bg-base rounded-lg transition-all"
              >
                Start New
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {geminiUnavailable && (
            <div className="mx-8 mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p className="text-sm font-medium">
                  Gemini API key is missing. Running in built-in demo mode. Set <code>VITE_GEMINI_API_KEY</code> in your environment and redeploy for full AI analysis and voice features.
                </p>
              </div>
            </div>
          )}
          <div className={cn("p-8", view === 'landing' ? "max-w-7xl mx-auto" : "")}>
            <AnimatePresence mode="wait">
          {view === 'landing' && (
            <motion.section
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="hero-section-bg interactive-shell relative overflow-hidden rounded-3xl px-6 py-20 md:px-10"
            >
              <div className="hero-float hero-float-1" />
              <div className="hero-float hero-float-2" />
              <div className="hero-float hero-float-3" />
              <div className="relative z-10 max-w-4xl mx-auto text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-brand-primary text-xs font-semibold mb-6 border border-teal-100">
                  <Brain size={14} />
                  <span>Powered by Clinical AI</span>
                </div>
                <h1 className="font-sans font-bold text-[clamp(44px,6.5vw,80px)] tracking-[-1.5px] leading-[1.05] text-[#0D2B28] mb-6">
                  Understand your health in <span className="text-[#00897B]">plain language.</span>
                </h1>
                <p className="text-[17px] font-[300] text-[#3D5C57] mb-10 max-w-[480px] mx-auto leading-[1.65]">
                  Expert medical analysis for reports, symptoms, and wearable data. Empathetic, accurate, and always ready to help you navigate your wellness journey.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button
                    onClick={() => setView('input')}
                    className="warm-glow-button w-full sm:w-auto px-8 py-4 bg-brand-primary text-white rounded-2xl font-semibold shadow-lg shadow-teal-100 hover:bg-brand-dark hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  >
                    Start Analysis <ArrowRight size={20} />
                  </button>
                  <button
                    onClick={() => setView('voice')}
                    className="w-full sm:w-auto px-8 py-4 bg-white border border-brand-primary text-brand-primary rounded-2xl font-semibold hover:bg-teal-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Mic size={20} />
                    Talk to MediAssist AI
                  </button>
                </div>

                <div className="mt-24 grid md:grid-cols-3 gap-8 text-left">
                  {[
                    { icon: FileText, title: "Report Parsing", desc: "Extract data from blood tests, lab panels, and imaging reports." },
                    { icon: Thermometer, title: "Symptom Logic", desc: "Map your experienced symptoms to potential health conditions." },
                    { icon: Pill, title: "Interaction Check", desc: "Flag potential side effects and drug-to-drug interactions." }
                  ].map((feature, idx) => (
                    <div key={idx} className="soft-card p-6 rounded-2xl bg-white/95 border border-border-base shadow-sm hover:shadow-md transition-all group">
                      <div className="w-12 h-12 rounded-2xl bg-bg-base flex items-center justify-center text-text-muted mb-4 group-hover:bg-teal-50 group-hover:text-brand-primary transition-colors">
                        <feature.icon size={24} />
                      </div>
                      <h3 className="text-lg font-bold mb-2 text-text-bold">{feature.title}</h3>
                      <p className="text-text-main text-sm leading-relaxed">{feature.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.section>
          )}

          {view === 'voice' && (
            <motion.div 
              key="voice"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="voice-orb-shell max-w-5xl mx-auto h-full flex flex-col"
            >
              <div className="flex-1 flex flex-col items-center justify-center py-8">
                <div className="relative mb-12">
                  <AnimatePresence>
                    {isListening && (
                      <motion.div 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 bg-brand-primary rounded-full blur-2xl"
                      />
                    )}
                  </AnimatePresence>
                  <div
                    className={cn(
                      "relative w-40 h-40 voice-orb rounded-full flex items-center justify-center transition-all shadow-2xl",
                      isListening ? "bg-red-500 scale-110" : "bg-brand-primary warm-glow-button"
                    )}
                  >
                    <span className="text-white text-center px-6 text-sm font-semibold leading-relaxed">
                      {isListening ? 'Listening… say hello to begin' : 'Preparing microphone...'}
                    </span>
                  </div>
                  
                  {loading && (
                    <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 text-brand-primary font-bold whitespace-nowrap">
                      <Loader2 size={24} className="animate-spin" />
                      <span>Analyzing...</span>
                    </div>
                  )}
                  {isPlaying && (
                    <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 text-brand-primary font-bold whitespace-nowrap">
                      <Volume2 size={24} className="animate-pulse" />
                      <span>Responding...</span>
                    </div>
                  )}
                </div>

                <div className="soft-card w-full max-w-2xl bg-white/95 rounded-3xl p-8 border border-border-base shadow-lg backdrop-blur-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-brand-primary">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h3 className="font-bold text-text-bold">Voice Consultation</h3>
                      <p className="text-xs text-text-muted">Speak naturally to your health companion</p>
                    </div>
                  </div>
                  <div className="min-h-[120px] max-h-[300px] overflow-y-auto mb-6 space-y-4 px-2">
                    {voiceError && (
                      <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs">
                        {voiceError}
                      </div>
                    )}
                    {voiceHistory.length === 0 && !transcript && !loading && (
                      <div className="text-center py-10 opacity-50 italic text-sm">
                        The microphone starts automatically. Say hello or ask something like:<br/>
                        "Can you explain my recent blood sugar levels?" or<br/>
                        "I've been feeling a bit dizzy today."
                      </div>
                    )}
                    {voiceHistory.map((entry, idx) => (
                      <div key={idx} className={cn(
                        "p-4 rounded-2xl text-sm leading-relaxed",
                        entry.role === 'user' ? "bg-bg-base text-text-bold ml-8" : "bg-teal-50 text-brand-dark mr-8 font-medium"
                      )}>
                        {entry.content}
                      </div>
                    ))}
                    {transcript && (
                      <div className="p-4 rounded-2xl text-sm bg-bg-base text-text-bold ml-8 opacity-60 italic">
                        {transcript}...
                      </div>
                    )}
                  </div>

                  {voiceHistory.length > 0 && (
                    <button 
                      onClick={() => {
                        setVoiceHistory([]);
                        setHasStartedVoiceConsultation(false);
                      }}
                      className="text-xs font-bold text-text-muted hover:text-brand-primary flex items-center gap-1 mx-auto"
                    >
                      Clear conversation
                    </button>
                  )}
                </div>

                <div className="w-full max-w-2xl bg-white rounded-3xl p-6 border border-border-base shadow-lg mt-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Upload size={20} />
                      </div>
                      <div>
                        <h3 className="font-bold text-text-bold">Upload Prescriptions & Records</h3>
                        <p className="text-xs text-text-muted">Share prescription files or report screenshots anytime during voice chat.</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Optional</span>
                  </div>

                  <div
                    {...getRootProps()}
                    className={cn(
                      "border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all",
                      isDragActive ? "border-teal-400 bg-teal-50/50" : "border-border-base hover:border-teal-300"
                    )}
                  >
                    <input {...getInputProps()} />
                    <div className="w-12 h-12 bg-bg-base rounded-xl flex items-center justify-center mx-auto mb-3 text-text-muted">
                      <Upload size={24} />
                    </div>
                    <h4 className="font-semibold text-text-bold mb-1">Drop files here or click to upload</h4>
                    <p className="text-xs text-text-muted">PDF, PNG, JPG, TXT, CSV, JSON</p>
                  </div>

                  {uploadMessage && (
                    <p className="text-xs text-text-muted mt-3 px-1">{uploadMessage}</p>
                  )}
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl flex gap-3 mb-8">
                <ShieldAlert className="text-status-warning shrink-0" size={20} />
                <p className="text-xs text-text-main leading-relaxed">
                  Voice Mode is designed for empathetic conversation. Please remember that all findings should be confirmed with your doctor. In case of absolute emergencies like chest pain or stroke, please dial emergency services immediately.
                </p>
              </div>
            </motion.div>
          )}

          {view === 'input' && (
            <motion.div 
              key="input"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="max-w-6xl mx-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-text-bold">Health Input Hub</h2>
                  <p className="text-text-muted text-sm">Provide your data for a comprehensive analysis</p>
                </div>
                {loading && (
                  <div className="flex items-center gap-2 text-brand-primary font-bold">
                    <Loader2 className="animate-spin" size={20} />
                    Analyzing...
                  </div>
                )}
              </div>

              <div className="grid lg:grid-cols-12 gap-8">
                {/* Left Column: Data Input */}
                <div className="lg:col-span-8 space-y-6">
                  <Card>
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                          <FileText size={20} />
                        </div>
                        <h3 className="font-bold">Medical Report</h3>
                      </div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Optional</span>
                    </div>
                    <div className="p-6">
                      <div {...getRootProps()} className={cn(
                        "border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all",
                        isDragActive ? "border-teal-400 bg-teal-50/50" : "border-border-base hover:border-teal-300"
                      )}>
                        <input {...getInputProps()} />
                        <div className="w-16 h-16 bg-bg-base rounded-2xl flex items-center justify-center mx-auto mb-4 text-text-muted">
                          <Upload size={32} />
                        </div>
                        <h4 className="font-bold text-lg mb-1 text-text-bold">Upload Laboratory Reports</h4>
                        <p className="text-text-muted text-sm mb-6">PDF, PNG, JPG (Blood work, Lipid panel, etc.)</p>
                        <button className="px-6 py-2 bg-white border border-border-base rounded-xl text-sm font-semibold hover:bg-bg-base transition-colors">
                          Select Files
                        </button>
                      </div>
                      
                      <div className="mt-6 flex items-center justify-between px-1">
                        <label className="block text-xs font-bold text-text-muted uppercase tracking-widest">Or paste report text here</label>
                        <button 
                          onClick={() => setReportText("Glucose: 155 mg/dL (Post-prandial)\nBP: 145/92 mmHg\nCreatinine: 1.4 mg/dL\nHeight: 175cm, Weight: 88kg")}
                          className="text-[10px] font-bold text-brand-primary hover:underline"
                        >
                          Use Sample Data
                        </button>
                      </div>
                      {uploadMessage && (
                        <p className="text-xs text-text-muted mt-3 px-1">{uploadMessage}</p>
                      )}
                      <textarea 
                        value={reportText}
                        onChange={(e) => setReportText(e.target.value)}
                        placeholder="Example: Hb1Ac 6.5, LDL 130mg/dL..."
                        className="w-full h-32 p-4 bg-bg-base rounded-2xl border-none focus:ring-2 focus:ring-teal-100 placeholder:text-text-muted text-sm resize-none mt-3"
                      />
                    </div>
                  </Card>

                  <Card>
                    <div className="p-6 border-b border-bg-base flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 text-brand-primary flex items-center justify-center">
                        <Activity size={20} />
                      </div>
                      <h3 className="font-bold text-text-bold">Smart Connect (Wearable Data)</h3>
                    </div>
                    <div className="p-6">
                      <div className="h-40 w-full mb-4 bg-bg-base rounded-2xl p-4 flex items-center justify-center border border-dashed border-border-base">
                        <div className="text-center">
                          <TrendingUp size={24} className="text-text-muted/40 mx-auto mb-2" />
                          <p className="text-xs text-text-muted">Continuous Glucose Monitor or Heart Rate Data</p>
                          <button className="mt-3 text-[10px] font-bold text-brand-primary px-3 py-1 bg-white border border-border-base rounded-lg shadow-sm">
                            Connect HealthKit / Garmin
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <div className="p-6 border-b border-bg-base flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-orange-50 text-status-warning flex items-center justify-center">
                        <Thermometer size={20} />
                      </div>
                      <h3 className="font-bold text-text-bold">Describe Symptoms</h3>
                    </div>
                    <div className="p-6">
                      <textarea 
                        value={symptoms}
                        onChange={(e) => setSymptoms(e.target.value)}
                        placeholder="I've been feeling fatigued for 2 weeks, with occasional headaches..."
                        className="w-full h-32 p-4 bg-bg-base rounded-2xl border-none focus:ring-2 focus:ring-teal-100 placeholder:text-text-muted text-sm resize-none"
                      />
                    </div>
                  </Card>
                </div>

                {/* Right Column: Profile & Action */}
                <div className="lg:col-span-4 space-y-6">
                  <Card>
                    <div className="p-6 border-b border-bg-base flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 text-brand-primary flex items-center justify-center">
                        <User size={20} />
                      </div>
                      <h3 className="font-bold text-text-bold">Patient Profile</h3>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase mb-1.5 px-1">Age & Sex</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input 
                            type="number" 
                            placeholder="Age"
                            value={profile.age}
                            onChange={(e) => setProfile({...profile, age: e.target.value})}
                            className="w-full px-4 py-2.5 bg-bg-base rounded-xl border-none focus:ring-2 focus:ring-teal-100 text-sm"
                          />
                          <select 
                            value={profile.sex}
                            onChange={(e) => setProfile({...profile, sex: e.target.value as any})}
                            className="w-full px-4 py-2.5 bg-bg-base rounded-xl border-none focus:ring-2 focus:ring-teal-100 text-sm"
                          >
                            <option>Male</option>
                            <option>Female</option>
                            <option>Other</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase mb-1.5 px-1">Known Conditions</label>
                        <input 
                          placeholder="e.g. Hypertension, Diabetes"
                          value={profile.conditions}
                          onChange={(e) => setProfile({...profile, conditions: e.target.value})}
                          className="w-full px-4 py-2.5 bg-bg-base rounded-xl border-none focus:ring-2 focus:ring-teal-100 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-text-muted uppercase mb-1.5 px-1">Medications</label>
                        <input 
                          placeholder="e.g. Metformin, Amlodipine"
                          value={profile.medications}
                          onChange={(e) => setProfile({...profile, medications: e.target.value})}
                          className="w-full px-4 py-2.5 bg-bg-base rounded-xl border-none focus:ring-2 focus:ring-teal-100 text-sm"
                        />
                      </div>
                    </div>
                  </Card>

                  <button 
                    disabled={loading || (!reportText && !symptoms)}
                    onClick={handleAnalyze}
                    className="w-full py-5 bg-brand-primary text-white rounded-2xl font-bold shadow-xl shadow-teal-100 hover:bg-brand-dark disabled:opacity-50 disabled:hover:translate-y-0 hover:-translate-y-1 transition-all flex items-center justify-center gap-3"
                  >
                    {loading ? <Loader2 className="animate-spin" /> : <ShieldAlert size={22} />}
                    {loading ? 'Processing Data...' : 'Confirm & Run Analysis'}
                  </button>

                  <div className="bg-orange-50 rounded-xl p-4 flex gap-3 border border-orange-100">
                    <AlertCircle className="text-status-warning shrink-0" size={18} />
                    <p className="text-[11px] text-text-main leading-normal italic">
                      MediAssist is an AI assistant, not a doctor. Data is processed securely but should never replace formal diagnosis.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'analysis' && analysis && (
            <motion.div 
              key="analysis"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-6xl mx-auto pb-20"
            >
              {/* Header Section */}
              <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 text-brand-primary text-[10px] font-bold uppercase tracking-wider mb-4 border border-teal-100">
                    <CheckCircle2 size={12} />
                    Analysis Complete
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight text-text-bold mb-2">Report Summary & Findings</h2>
                  <p className="text-text-muted text-sm max-w-2xl">
                    Comprehensive synthesis of your physiological data and clinical observations.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => speak(analysis.summary)}
                    className="px-5 py-2.5 bg-teal-50 border border-teal-100 rounded-xl text-sm font-bold text-brand-primary hover:bg-teal-100 transition-colors flex items-center gap-2"
                  >
                    <Volume2 size={16} /> Listen to Summary
                  </button>
                  <button className="px-5 py-2.5 bg-white border border-border-base rounded-xl text-sm font-bold text-text-main hover:bg-bg-base transition-colors flex items-center gap-2">
                    <FileText size={16} /> Export
                  </button>
                  <button className="px-5 py-2.5 bg-brand-primary text-white rounded-xl text-sm font-bold hover:bg-brand-dark transition-colors">
                    Share Results
                  </button>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-8">
                {/* Main Content Area */}
                <div className="lg:col-span-8 space-y-8">
                  {/* Summary */}
                  <Card className="bg-white border-border-base">
                    <div className="p-8">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-teal-50 text-brand-primary flex items-center justify-center">
                          <MessageSquareHeart size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-text-bold">Plain-Language Summary</h3>
                      </div>
                      <p className="text-base text-text-main leading-relaxed mb-6 font-medium">
                        {analysis.summary}
                      </p>
                    </div>
                  </Card>

                  {/* Findings Table */}
                  <Card>
                    <div className="p-6 border-b border-bg-base flex items-center justify-between bg-white">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-bg-base text-text-muted flex items-center justify-center">
                          <ClipboardList size={20} />
                        </div>
                        <h3 className="font-bold text-text-bold">Key Findings Table</h3>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-bg-base/30 text-[11px] font-bold text-text-muted uppercase tracking-widest border-bottom border-bg-base">
                            <th className="px-6 py-4">Test</th>
                            <th className="px-6 py-4">Value</th>
                            <th className="px-6 py-4">Range</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Meaning</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analysis.findings.map((f, i) => (
                            <tr key={i} className="hover:bg-bg-base/20 transition-colors">
                              <td className="px-6 py-4">
                                <span className="font-bold text-text-bold text-sm tracking-tight">{f.test}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="font-mono text-sm font-bold text-text-main">{f.value} {f.unit}</span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-[11px] text-text-muted font-medium">{f.referenceRange}</span>
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge status={f.status} />
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-xs text-text-main leading-relaxed max-w-xs">{f.meaning}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* Trends */}
                  {analysis.trends && (
                    <Card>
                      <div className="p-6 border-b border-bg-base flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-teal-50 text-brand-primary flex items-center justify-center">
                          <TrendingUp size={20} />
                        </div>
                        <h3 className="font-bold text-text-bold">Trend Insights</h3>
                      </div>
                      <div className="p-6">
                        <p className="text-text-main text-sm leading-relaxed">{analysis.trends}</p>
                      </div>
                    </Card>
                  )}

                  {/* Differential Diagnosis */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-text-bold">
                      <Stethoscope size={24} className="text-brand-primary" />
                      Possible Considerations
                    </h3>
                    <div className="grid md:grid-cols-1 gap-4">
                      {analysis.diagnoses.map((d, i) => (
                        <div key={i}>
                          <Card className={cn(
                            "transition-all",
                            d.urgentReferral && "border-red-200 bg-red-50/30"
                          )}>
                            <div className="p-6">
                              <div className="flex items-start justify-between mb-4">
                                <div>
                                  <h4 className="text-base font-bold text-text-bold">{d.condition}</h4>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-bold uppercase text-text-muted tracking-wider">Likelihood:</span>
                                    <span className="text-[11px] font-bold text-brand-primary">{d.likelihood}</span>
                                  </div>
                                </div>
                                {d.urgentReferral && (
                                  <div className="px-3 py-1 bg-red-600 text-white rounded-lg text-[10px] font-bold flex items-center gap-1">
                                    <AlertCircle size={10} /> URGENT
                                  </div>
                                )}
                              </div>
                              <p className="text-sm text-text-main leading-relaxed mb-4">
                                <span className="font-bold text-text-bold">Supporting Evidence:</span> {d.supportingEvidence}
                              </p>
                              {d.ruledOut && (
                                <div className="p-3 bg-bg-base/50 rounded-xl text-xs text-text-muted border border-border-base">
                                  <span className="font-bold text-text-bold">Differential Context:</span> {d.ruledOut}
                                </div>
                              )}
                            </div>
                          </Card>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sidebar Column */}
                <div className="lg:col-span-4 space-y-6">
                  {/* Flags Sidebar */}
                  <Card className="border-border-base">
                    <div className="p-6 border-b border-bg-base flex items-center gap-2">
                       <h3 className="font-bold text-text-bold text-sm uppercase tracking-wider flex items-center gap-2">
                         Flags & Alerts
                       </h3>
                    </div>
                    <div className="p-6 space-y-4">
                      {analysis.flags.length > 0 ? analysis.flags.map((f, i) => (
                        <div key={i} className={cn(
                          "p-4 rounded-xl flex gap-3",
                          f.status.includes('CRITICAL') ? "bg-red-50 border-l-4 border-status-danger" : "bg-orange-50 border-l-4 border-status-warning"
                        )}>
                          <div className="flex-1">
                            <span className="alert-title block text-[13px] font-bold text-text-bold mb-1">{f.test} ({f.status})</span>
                            <p className="text-xs text-text-main leading-relaxed">{f.explanation}</p>
                          </div>
                        </div>
                      )) : (
                        <p className="text-xs text-text-muted italic">No critical flags detected.</p>
                      )}
                    </div>
                  </Card>

                  {/* Next Steps */}
                  <Card className="flex-1">
                    <div className="p-6 border-b border-bg-base">
                      <h3 className="font-bold text-text-bold text-sm uppercase tracking-wider">Recommended Next Steps</h3>
                    </div>
                    <div className="p-6 space-y-6">
                       <ul className="space-y-4">
                        {analysis.nextSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-4">
                            <div className="w-5 h-5 bg-brand-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                              {i + 1}
                            </div>
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{step.urgency}</span>
                              <p className="text-[13px] font-medium text-text-main leading-tight">{step.action}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      
                      <div className="pt-6 border-t border-border-base">
                        <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1.5 block px-1">Suggested Specialist</span>
                        <div className="text-sm font-bold text-brand-dark px-1">{analysis.specialist?.type || 'General Practitioner'}</div>
                        <div className="text-[11px] text-text-muted leading-relaxed px-1 mt-1">{analysis.specialist?.reason || 'For general health monitoring.'}</div>
                      </div>
                    </div>
                  </Card>

                  {/* Medication Safety Badge */}
                  {analysis.medNotes && analysis.medNotes.length > 0 && (
                    <Card className="bg-blue-50/30 border-blue-100">
                      <div className="p-6 border-b border-blue-100/50 flex items-center gap-3">
                        <Pill size={18} className="text-status-info" />
                        <h3 className="font-bold text-text-bold text-sm uppercase tracking-wider">Medication Safety</h3>
                      </div>
                      <div className="p-6 space-y-4">
                        {analysis.medNotes.map((m, i) => (
                          <div key={i} className="space-y-1.5 px-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[13px] text-text-bold">{m.medication}</span>
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded uppercase",
                                m.severity === 'SEVERE' ? 'bg-red-100 text-status-danger' : 'bg-blue-100 text-status-info'
                              )}>
                                {m.severity}
                              </span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">{m.note}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
    );
  }
