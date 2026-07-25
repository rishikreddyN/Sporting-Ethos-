import dotenv from 'dotenv';
dotenv.config();

export interface AiTriageResult {
  summary: string;
  urgency: 'Routine' | 'Moderate' | 'Prompt attention suggested';
}

export async function summarizeSymptoms(symptoms: string): Promise<AiTriageResult | null> {
  if (!symptoms || !symptoms.trim()) {
    return null;
  }

  const prompt = `You are a clinical triage assistant. Summarize the following patient symptoms into a one-line doctor-friendly summary (maximum 10 words, clinical tone) and categorize the urgency as one of: Routine, Moderate, or Prompt attention suggested.
Respond ONLY with a JSON object in this format:
{
  "summary": "one-line clinical summary",
  "urgency": "Routine" | "Moderate" | "Prompt attention suggested"
}
Symptoms: "${symptoms}"`;

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
            { role: 'user', content: prompt }
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
              urgency: normalizeUrgency(parsed.urgency)
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
          contents: [{ parts: [{ text: prompt }] }],
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
              urgency: normalizeUrgency(parsed.urgency)
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

function normalizeUrgency(urgency: string): 'Routine' | 'Moderate' | 'Prompt attention suggested' {
  const normalized = String(urgency).toLowerCase().trim();
  if (normalized.includes('routine')) {
    return 'Routine';
  }
  if (normalized.includes('moderate')) {
    return 'Moderate';
  }
  if (normalized.includes('prompt') || normalized.includes('suggested') || normalized.includes('urgent') || normalized.includes('attention')) {
    return 'Prompt attention suggested';
  }
  return 'Moderate'; // fallback default
}
