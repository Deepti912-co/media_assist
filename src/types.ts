export type Status = 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL LOW' | 'CRITICAL HIGH' | 'BORDERLINE';

export interface MedicalTestResult {
  test: string;
  value: string;
  unit: string;
  referenceRange: string;
  status: Status;
  meaning: string;
}

export interface DifferentialDiagnosis {
  condition: string;
  likelihood: string;
  supportingEvidence: string;
  ruledOut?: string;
  urgentReferral: boolean;
}

export interface MedicationNote {
  medication: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  note: string;
}

export interface NextStep {
  urgency: 'Immediate' | 'Soon' | 'Routine' | 'Lifestyle';
  action: string;
}

export interface AnalysisOutput {
  summary: string;
  findings: MedicalTestResult[];
  flags: { test: string; status: Status; explanation: string }[];
  trends?: string;
  diagnoses: DifferentialDiagnosis[];
  medNotes?: MedicationNote[];
  nextSteps: NextStep[];
  specialist?: { type: string; reason: string };
}

export interface PatientProfile {
  age?: string;
  sex?: 'Male' | 'Female' | 'Other';
  conditions?: string;
  medications?: string;
  allergies?: string;
}

export type Urgency = 'critical' | 'high' | 'normal';
export type Intent = 'REPORT_QUERY' | 'SYMPTOM_INPUT' | 'MEDICATION_QUESTION' | 'FOLLOW_UP' | 'GENERAL_HEALTH' | 'EMERGENCY';

export interface VoiceClassification {
  intent: Intent;
  urgency: Urgency;
}
