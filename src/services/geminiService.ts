import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisOutput, PatientProfile, VoiceClassification } from "../types";

const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY) as string;
const missingApiKeyError = "Missing Gemini API key. Set VITE_GEMINI_API_KEY (or GEMINI_API_KEY).";

export const hasGeminiApiKey = Boolean(apiKey);

const getClient = () => {
  if (!apiKey) {
    throw new Error(missingApiKeyError);
  }
  return new GoogleGenAI({ apiKey });
};

export async function classifyIntent(userInput: string): Promise<VoiceClassification> {
  const ai = getClient();
  const prompt = `
    TASK
    You are an intent classifier for a voice medical assistant. Given the user's spoken input (transcribed to text), return ONLY a JSON object with two fields: "intent" and "urgency". Nothing else. No explanation. No preamble.

    INTENT VALUES
    Use exactly one of these strings:
    "REPORT_QUERY", "SYMPTOM_INPUT", "MEDICATION_QUESTION", "FOLLOW_UP", "GENERAL_HEALTH", "EMERGENCY"

    URGENCY VALUES
    Use exactly one of these strings:
    "critical", "high", "normal"

    EMERGENCY TRIGGER WORDS
    If ANY of these words or phrases appear in the input, always return EMERGENCY / critical regardless of other context:
    chest pain, heart attack, can't breathe, difficulty breathing, unconscious, not responding, stroke, severe bleeding, overdose, poisoning, suicidal, want to die, end my life, severe chest tightness, collapsed, seizure, fits

    AMBIGUOUS INPUT HANDLING
    If the utterance is too short or unclear to classify confidently, return:
    {"intent": "FOLLOW_UP", "urgency": "normal"}

    Input: "${userInput}"
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: { type: Type.STRING },
          urgency: { type: Type.STRING }
        },
        required: ["intent", "urgency"]
      }
    }
  });

  return JSON.parse(response.text) as VoiceClassification;
}

export async function analyzeMedicalData(
  reportText: string,
  symptoms: string,
  profile: PatientProfile,
  deviceData?: string
): Promise<AnalysisOutput> {
  const ai = getClient();
  const prompt = `
    You are MediAssist, an expert AI medical assistant. 
    Analyze the following data following your systematic 6-layer protocol:
    
    1. MEDICAL REPORT TEXT: ${reportText || "None provided"}
    2. SYMPTOM DESCRIPTION: ${symptoms || "None provided"}
    3. PATIENT PROFILE: ${JSON.stringify(profile)}
    4. DEVICE DATA: ${deviceData || "None provided"}

    EXECUTE ALL LAYERS:
    - Layer 2: Parse all structured values (Test, Value, Unit, Ref Range).
    - Layer 3: Execute Task A (Flagging), Task B (Trends), Task C (Drug interactions), Task D (Differentials).
    - Layer 4: Calibrate ranges for Age: ${profile.age}, Sex: ${profile.sex}.
    - Layer 5: Format exactly as structured JSON.

    CRITICAL SAFETY: If values are critically abnormal (e.g., K > 6.5, Hb < 7), explicitly flag for IMMEDIATE medical attention.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                test: { type: Type.STRING },
                value: { type: Type.STRING },
                unit: { type: Type.STRING },
                referenceRange: { type: Type.STRING },
                status: { type: Type.STRING, enum: ["NORMAL", "LOW", "HIGH", "CRITICAL LOW", "CRITICAL HIGH", "BORDERLINE"] },
                meaning: { type: Type.STRING }
              },
              required: ["test", "value", "unit", "referenceRange", "status", "meaning"]
            }
          },
          flags: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                test: { type: Type.STRING },
                status: { type: Type.STRING },
                explanation: { type: Type.STRING }
              }
            }
          },
          trends: { type: Type.STRING },
          diagnoses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                condition: { type: Type.STRING },
                likelihood: { type: Type.STRING },
                supportingEvidence: { type: Type.STRING },
                ruledOut: { type: Type.STRING },
                urgentReferral: { type: Type.BOOLEAN }
              }
            }
          },
          medNotes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                medication: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ["MILD", "MODERATE", "SEVERE"] },
                note: { type: Type.STRING }
              }
            }
          },
          nextSteps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                urgency: { type: Type.STRING, enum: ["Immediate", "Soon", "Routine", "Lifestyle"] },
                action: { type: Type.STRING }
              }
            }
          },
          specialist: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              reason: { type: Type.STRING }
            }
          }
        },
        required: ["summary", "findings", "flags", "diagnoses", "nextSteps"]
      }
    }
  });

  return JSON.parse(response.text) as AnalysisOutput;
}

export async function generateVoiceResponse(
  userInput: string,
  profile: PatientProfile,
  currentAnalysis?: AnalysisOutput | null,
  history: { role: 'user' | 'model', content: string }[] = []
): Promise<string> {
  const ai = getClient();
  const systemInstruction = `
    You are MediAssist, an expert voice-first AI medical assistant. 
    You are designed to feel like talking to a knowledgeable, empathetic health companion.
    
    VOICE BEHAVIOUR RULES:
    1. NEVER use bullet points, numbered lists, tables, markdown, or formatting symbols. 
    2. Write in flowing, natural spoken sentences only.
    3. Say medical full forms: "complete blood count, or CBC" not just "CBC". 
    4. Keep responses between 3 and 6 sentences. Offer to continue.
    5. At the end of every response about a medical finding, say: "Please remember, this is for your information only — your doctor is the right person to advise on next steps."
    6. EMERGENCY: If the patient mentions chest pain, stroke symptoms, etc., IMMEDIATELY say: "This sounds like a medical emergency. Please call 112 right now or ask someone nearby to help you. Do not wait."

    INTENT ROUTING:
    - REPORT_QUERY: Analysis logic for medical reports.
    - SYMPTOM_INPUT: Clarifying questions + possibilities.
    - MEDICATION_QUESTION: Factual info + pharmacist disclaimer.
    - EMERGENCY: Immediate routing to help.
    
    PATIENT CONTEXT:
    - Age: ${profile.age}, Sex: ${profile.sex}
    - Conditions: ${profile.conditions || 'None'}
    - Medications: ${profile.medications || 'None'}
    
    CURRENT ANALYSIS STATE: ${currentAnalysis ? JSON.stringify(currentAnalysis) : 'No report analysis performed yet.'}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: userInput }] }
    ],
    config: {
      systemInstruction: systemInstruction,
    }
  });

  return response.text;
}

export async function generateSpeech(text: string): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: `Read this with an empathetic, calm medical professional voice: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Failed to generate speech");
  return base64Audio;
}
