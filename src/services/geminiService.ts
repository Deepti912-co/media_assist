import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisOutput, PatientProfile, VoiceClassification } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const missingApiKeyError = "Missing Gemini API key. Set VITE_GEMINI_API_KEY.";
const defaultTextModel = (import.meta.env.VITE_GEMINI_TEXT_MODEL as string | undefined) || "gemini-2.5-flash";

export const hasGeminiApiKey = Boolean(apiKey);

const getClient = () => {
  if (!apiKey) {
    throw new Error(missingApiKeyError);
  }
  return new GoogleGenAI({ apiKey });
};

const emergencyKeywords = [
  "chest pain",
  "heart attack",
  "can't breathe",
  "difficulty breathing",
  "unconscious",
  "not responding",
  "stroke",
  "severe bleeding",
  "overdose",
  "poisoning",
  "suicidal",
  "want to die",
  "end my life",
  "severe chest tightness",
  "collapsed",
  "seizure",
  "fits"
];

const hasEmergencySignal = (input: string) =>
  emergencyKeywords.some((keyword) => input.toLowerCase().includes(keyword));

const getResponseText = (response: unknown): string => {
  if (!response || typeof response !== "object") {
    return "";
  }

  const candidate = response as {
    text?: string | (() => string);
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  if (typeof candidate.text === "function") {
    return candidate.text().trim();
  }
  if (typeof candidate.text === "string") {
    return candidate.text.trim();
  }

  const partText = candidate.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return partText || "";
};

const parseJsonResponse = <T>(rawText: string): T => {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    const objectMatch = rawText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }
    throw new Error("Gemini returned an invalid JSON response.");
  }
};

export async function classifyIntent(userInput: string): Promise<VoiceClassification> {
  if (!hasGeminiApiKey) {
    if (hasEmergencySignal(userInput)) {
      return { intent: "EMERGENCY", urgency: "critical" };
    }
    if (/medicine|medication|drug|dose|tablet|pill/i.test(userInput)) {
      return { intent: "MEDICATION_QUESTION", urgency: "normal" };
    }
    if (/report|lab|test|blood|result|scan/i.test(userInput)) {
      return { intent: "REPORT_QUERY", urgency: "normal" };
    }
    if (/pain|fever|cough|headache|fatigue|symptom|nausea|dizzy/i.test(userInput)) {
      return { intent: "SYMPTOM_INPUT", urgency: "normal" };
    }
    return { intent: "FOLLOW_UP", urgency: "normal" };
  }

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
    model: defaultTextModel,
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

  const rawText = getResponseText(response);
  return parseJsonResponse<VoiceClassification>(rawText);
}

export async function analyzeMedicalData(
  reportText: string,
  symptoms: string,
  profile: PatientProfile,
  deviceData?: string
): Promise<AnalysisOutput> {
  if (!hasGeminiApiKey) {
    const hasKidneySignal = /creatinine/i.test(reportText);
    const hasGlucoseSignal = /glucose|sugar|hba1c/i.test(`${reportText} ${symptoms}`);

    return {
      summary: "Demo analysis mode is active because the Gemini API key is not configured. I reviewed your symptoms and report text using built-in rules and highlighted possible follow-up areas.",
      findings: [
        ...(hasKidneySignal
          ? [{
              test: "Creatinine",
              value: "Mildly elevated",
              unit: "mg/dL",
              referenceRange: "0.6 - 1.3",
              status: "HIGH" as const,
              meaning: "Can suggest dehydration or reduced kidney filtration. Please review with your clinician."
            }]
          : []),
        ...(hasGlucoseSignal
          ? [{
              test: "Glucose trend",
              value: "Borderline pattern",
              unit: "mg/dL",
              referenceRange: "70 - 99 fasting",
              status: "BORDERLINE" as const,
              meaning: "Could indicate early glucose regulation issues and should be rechecked."
            }]
          : []),
        {
          test: "Symptom review",
          value: symptoms ? "Symptoms captured" : "No symptoms entered",
          unit: "-",
          referenceRange: "-",
          status: symptoms ? "BORDERLINE" : "NORMAL",
          meaning: symptoms
            ? "Symptoms were considered in this rules-based summary."
            : "Add symptoms to improve the quality of the demo analysis."
        }
      ],
      flags: hasKidneySignal || hasGlucoseSignal
        ? [{
            test: "Follow-up recommended",
            status: "BORDERLINE",
            explanation: "Potential kidney and/or glucose markers were detected from your provided text."
          }]
        : [],
      trends: "No longitudinal trend data available in demo mode.",
      diagnoses: [{
        condition: "Needs clinician follow-up",
        likelihood: "Moderate",
        supportingEvidence: "Rule-based findings from provided report and symptoms.",
        ruledOut: "A formal diagnosis cannot be made in demo mode.",
        urgentReferral: false
      }],
      medNotes: [{
        medication: profile.medications || "No medication list provided",
        severity: "MILD",
        note: "Medication interaction checking is limited in demo mode."
      }],
      nextSteps: [
        { urgency: "Routine", action: "Book a routine consultation to review lab markers and symptoms." },
        { urgency: "Lifestyle", action: "Hydrate, monitor symptoms, and keep a record of changes for your clinician." }
      ],
      specialist: {
        type: "Primary Care",
        reason: "Initial review of reported findings and symptom timeline."
      }
    };
  }

  const ai = getClient();
  const prompt = `
    You are MediAssist AI, a clinical-grade medical assistant (not a doctor).
    Analyze the following data safely and conservatively.
    
    1. MEDICAL REPORT TEXT: ${reportText || "None provided"}
    2. SYMPTOM DESCRIPTION: ${symptoms || "None provided"}
    3. PATIENT PROFILE: ${JSON.stringify(profile)}
    4. DEVICE DATA: ${deviceData || "None provided"}

    REQUIRED APPROACH:
    - Parse structured values (test, value, unit, reference range).
    - Flag abnormalities and correlate with symptoms and profile (Age: ${profile.age}, Sex: ${profile.sex}).
    - Use probabilistic language only; never provide a definitive diagnosis.
    - Include practical next steps, monitoring guidance, and follow-up testing suggestions.
    - If data is incomplete, clearly reflect uncertainty.

    CRITICAL SAFETY:
    - If values are critically abnormal (e.g., K > 6.5, Hb < 7) or symptoms suggest danger, explicitly mark urgent referral and immediate medical attention.
  `;

  const response = await ai.models.generateContent({
    model: defaultTextModel,
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

  const rawText = getResponseText(response);
  return parseJsonResponse<AnalysisOutput>(rawText);
}

export async function generateVoiceResponse(
  userInput: string,
  profile: PatientProfile,
  currentAnalysis?: AnalysisOutput | null,
  history: { role: 'user' | 'model', content: string }[] = [],
  preferredLanguage = "English"
): Promise<string> {
  if (!hasGeminiApiKey) {
    if (hasEmergencySignal(userInput)) {
      return "This could be serious. I strongly recommend seeking immediate medical attention. If you have severe symptoms, call your local emergency services now.";
    }

    return "I’m running in demo mode right now because the Gemini key is missing, but I can still help with general guidance. Based on what you shared, keep tracking your symptoms and arrange a routine medical review so a clinician can interpret your findings safely. If your symptoms suddenly worsen, seek urgent care immediately. Please remember, this is for your information only — your doctor is the right person to advise on next steps.";
  }

  const ai = getClient();
  const systemInstruction = `
    You are MediAssist AI, a clinical-grade medical assistant (not a doctor).
    Speak in ${preferredLanguage} unless the user asks to switch.

    CORE SAFETY RULES:
    - Never claim to be a doctor or give definitive diagnoses.
    - Use probabilistic language such as "this may indicate" and "possible causes include".
    - Prioritize safety and escalate when dangerous symptoms are present.
    - If urgent red flags are present, clearly say: "This could be serious. I strongly recommend seeking immediate medical attention."

    VOICE CONVERSATION STYLE:
    - Keep the tone calm, warm, human, and empathetic.
    - Ask one clarifying question at a time.
    - Use simple, plain language unless the user asks for technical details.
    - Keep spoken responses short and pause-friendly.
    - Do not use bullet points, numbered lists, markdown, or tables.
    - Begin by briefly summarizing what you understood, then ask the next best question.

    MEDICAL WORKFLOW:
    1. Parse provided reports, symptoms, prescriptions, profile, and optional wearable data.
    2. Identify abnormal values using standard ranges and correlate with symptoms.
    3. Mention possible interpretations and a risk level (low, moderate, high) when relevant.
    4. Provide safe guidance: lifestyle tips, monitoring advice, follow-up tests, and adherence reminders.
    5. Never prescribe new medicines or new dosages.

    WHEN DATA IS INCOMPLETE:
    - Ask follow-up questions instead of guessing.
    - If uncertain, say: "I don’t have enough information to be certain, but here’s what it could mean…"

    INTENT ROUTING:
    - REPORT_QUERY: Explain findings in simple language and ask one clarifying question.
    - SYMPTOM_INPUT: Ask one focused follow-up question and share safe possible causes.
    - MEDICATION_QUESTION: Reinforce adherence/safety and advise clinician/pharmacist follow-up for changes.
    - EMERGENCY: Immediate safety escalation.
    
    PATIENT CONTEXT:
    - Age: ${profile.age}, Sex: ${profile.sex}
    - Conditions: ${profile.conditions || 'None'}
    - Medications: ${profile.medications || 'None'}
    
    CURRENT ANALYSIS STATE: ${currentAnalysis ? JSON.stringify(currentAnalysis) : 'No report analysis performed yet.'}
  `;

  const response = await ai.models.generateContent({
    model: defaultTextModel,
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: userInput }] }
    ],
    config: {
      systemInstruction: systemInstruction,
    }
  });

  return getResponseText(response);
}

export async function generateVoiceResponseStream(
  userInput: string,
  profile: PatientProfile,
  currentAnalysis: AnalysisOutput | null | undefined,
  history: { role: 'user' | 'model', content: string }[] = [],
  onChunk?: (text: string) => void,
  preferredLanguage = "English"
): Promise<string> {
  if (!hasGeminiApiKey) {
    const fallback = await generateVoiceResponse(userInput, profile, currentAnalysis, history, preferredLanguage);
    onChunk?.(fallback);
    return fallback;
  }

  const ai = getClient();
  const systemInstruction = `
    You are MediAssist AI, a clinical-grade medical assistant (not a doctor).
    Speak in ${preferredLanguage} unless the user asks to switch.

    CORE SAFETY RULES:
    - Never claim to be a doctor or give definitive diagnoses.
    - Use probabilistic language such as "this may indicate" and "possible causes include".
    - Prioritize safety and escalate when dangerous symptoms are present.
    - If urgent red flags are present, clearly say: "This could be serious. I strongly recommend seeking immediate medical attention."

    VOICE CONVERSATION STYLE:
    - Keep the tone calm, warm, human, and empathetic.
    - Ask one clarifying question at a time.
    - Use simple, plain language unless the user asks for technical details.
    - Keep spoken responses short and pause-friendly.
    - Do not use bullet points, numbered lists, markdown, or tables.
    - Begin by briefly summarizing what you understood, then ask the next best question.

    MEDICAL WORKFLOW:
    1. Parse provided reports, symptoms, prescriptions, profile, and optional wearable data.
    2. Identify abnormal values using standard ranges and correlate with symptoms.
    3. Mention possible interpretations and a risk level (low, moderate, high) when relevant.
    4. Provide safe guidance: lifestyle tips, monitoring advice, follow-up tests, and adherence reminders.
    5. Never prescribe new medicines or new dosages.

    WHEN DATA IS INCOMPLETE:
    - Ask follow-up questions instead of guessing.
    - If uncertain, say: "I don’t have enough information to be certain, but here’s what it could mean…"

    INTENT ROUTING:
    - REPORT_QUERY: Explain findings in simple language and ask one clarifying question.
    - SYMPTOM_INPUT: Ask one focused follow-up question and share safe possible causes.
    - MEDICATION_QUESTION: Reinforce adherence/safety and advise clinician/pharmacist follow-up for changes.
    - EMERGENCY: Immediate safety escalation.
    
    PATIENT CONTEXT:
    - Age: ${profile.age}, Sex: ${profile.sex}
    - Conditions: ${profile.conditions || 'None'}
    - Medications: ${profile.medications || 'None'}
    
    CURRENT ANALYSIS STATE: ${currentAnalysis ? JSON.stringify(currentAnalysis) : 'No report analysis performed yet.'}
  `;

  const stream = await ai.models.generateContentStream({
    model: defaultTextModel,
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: userInput }] }
    ],
    config: {
      systemInstruction
    }
  });

  let fullText = '';
  for await (const chunk of stream) {
    const chunkText = getResponseText(chunk);
    if (!chunkText) {
      continue;
    }
    fullText += chunkText;
    onChunk?.(fullText);
  }

  return fullText.trim();
}

export async function generateSpeech(text: string, languageCode = "en-US"): Promise<string> {
  const ai = getClient();
  const languageNameMap: Record<string, string> = {
    "en-US": "English",
    "hi-IN": "Hindi",
    "mr-IN": "Marathi",
    "gu-IN": "Gujarati",
    "pa-IN": "Punjabi",
    "bn-IN": "Bengali",
    "kn-IN": "Kannada",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
  };
  const targetLanguage = languageNameMap[languageCode] || languageCode;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{
      parts: [{
        text: `Speak this response in ${targetLanguage} with native pronunciation, smooth pacing, and a soft empathetic medical tone. Do not spell words letter by letter. Text: ${text}`
      }]
    }],
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

export async function transcribeVoiceInput(
  audioBase64: string,
  mimeType: string,
  languageCode = "en-US"
): Promise<string> {
  if (!hasGeminiApiKey) {
    throw new Error("Voice transcription requires VITE_GEMINI_API_KEY.");
  }

  const ai = getClient();
  const response = await ai.models.generateContent({
    model: defaultTextModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Transcribe this audio to plain text in ${languageCode}. Return only the transcript text without labels, notes, or markdown.`
          },
          {
            inlineData: {
              mimeType,
              data: audioBase64
            }
          }
        ]
      }
    ]
  });

  return getResponseText(response).trim();
}
