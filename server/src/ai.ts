import dotenv from 'dotenv';
dotenv.config();

export interface AiTriageResult {
  summary: string;
  urgency: 'routine' | 'moderate' | 'emergency';
  reasoning: string;
}

export async function summarizeSymptoms(symptoms: string): Promise<AiTriageResult | null> {
  // Default to "routine" with summary "No specific symptoms provided." if empty or unclear
  if (!symptoms || !symptoms.trim()) {
    return {
      summary: 'No specific symptoms provided.',
      urgency: 'routine',
      reasoning: 'No symptom description was entered.'
    };
  }

  const systemPrompt = `You are a clinical triage assistant helping a front-desk system flag urgency for a doctor — you are NOT diagnosing, only triaging based on language patterns in what the patient typed.

Given the patient's self-reported symptom text, respond ONLY with a JSON object in this exact format:

{
  "summary": "one short, doctor-friendly sentence rephrasing the complaint",
  "urgency": "routine" | "moderate" | "emergency",
  "reasoning": "one short phrase explaining why this urgency level was chosen"
}

Guidelines for urgency:
- "emergency": language suggesting severe pain, difficulty breathing, chest pain, loss of consciousness, heavy bleeding, sudden severe onset, numbness/paralysis, or any wording implying a potentially life-threatening or rapidly worsening condition.
- "moderate": persistent or worsening pain, moderate discomfort, symptoms lasting several days, or anything that sounds like it needs timely but not immediate attention.
- "routine": mild, vague, minor, or general wellness/checkup-type language.

Never provide medical advice, a diagnosis, or treatment suggestions. Only classify urgency and rephrase the complaint neutrally. If the text is empty or unclear, default to "routine" with summary "No specific symptoms provided."`;

  // 1. Try Groq API
  if (process.env.GROQ_API_KEY) {
    try {
      console.log('[AI Triage] Attempting Groq API...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: symptoms }
          ],
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const contentStr = data.choices?.[0]?.message?.content;
        if (contentStr) {
          const parsed = JSON.parse(contentStr);
          if (parsed.summary && parsed.urgency) {
            return {
              summary: parsed.summary,
              urgency: normalizeUrgency(parsed.urgency),
              reasoning: parsed.reasoning || 'No specific reasoning provided by AI.'
            };
          }
        }
      } else {
        console.error('[AI Triage] Groq API returned error status:', response.status, await response.text());
      }
    } catch (err) {
      console.error('[AI Triage] Groq API request failed:', err);
    }
  }

  // 2. Try Gemini API
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('[AI Triage] Attempting Gemini API...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\nPatient symptoms:\n"${symptoms}"` }]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.summary && parsed.urgency) {
            return {
              summary: parsed.summary,
              urgency: normalizeUrgency(parsed.urgency),
              reasoning: parsed.reasoning || 'No specific reasoning provided by AI.'
            };
          }
        }
      } else {
        console.error('[AI Triage] Gemini API returned error status:', response.status, await response.text());
      }
    } catch (err) {
      console.error('[AI Triage] Gemini API request failed:', err);
    }
  }

  console.log('[AI Triage] No valid API keys found or AI calls failed.');
  return null;
}

function normalizeUrgency(urgency: string): 'routine' | 'moderate' | 'emergency' {
  const normalized = String(urgency).toLowerCase().trim();
  if (normalized.includes('emergency') || normalized.includes('urgent') || normalized.includes('prompt')) {
    return 'emergency';
  }
  if (normalized.includes('moderate')) {
    return 'moderate';
  }
  return 'routine';
}
