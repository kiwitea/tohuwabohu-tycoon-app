import { GoogleGenAI, Type } from "@google/genai";
import { format } from "date-fns";

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });

export interface Puzzle {
  date: string;
  centerLetter: string;
  outerLetters: string[];
  validWords: string[];
  maxPoints: number;
  pangrams: string[];
}

export async function generateDailyPuzzle(date: Date): Promise<Puzzle> {
  const dateStr = format(date, "yyyy-MM-dd");
  
  const prompt = `Generate a German Spelling Bee puzzle for the date ${dateStr}. 
  Rules:
  1. Provide 7 unique letters. One is the "center" letter (must be used in every word).
  2. Provide a list of valid German words that can be formed using ONLY these 7 letters.
  3. Each word must be at least 4 letters long.
  4. Each word MUST contain the center letter.
  5. Words must be common German dictionary words (Infinitives, singular nouns). 
  6. NO plurals, NO declinations (no "gehst", "gingst", only "gehen"), NO brands, NO place names.
  7. There must be at least one "pangram" (a word using all 7 letters).
  8. Limit the total number of words to around 20-40 for a manageable daily challenge.
  9. The letters should be lowercase.
  
  Return the data in JSON format.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          centerLetter: { type: Type.STRING },
          outerLetters: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "6 unique letters excluding the center letter"
          },
          validWords: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          pangrams: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Words from validWords that use all 7 letters"
          }
        },
        required: ["centerLetter", "outerLetters", "validWords", "pangrams"]
      }
    }
  });

  const data = JSON.parse(response.text);
  
  // Calculate max points
  // 4-letter words: 1 point
  // Longer words: length points
  // Pangram: length + 7 bonus points
  let maxPoints = 0;
  data.validWords.forEach((word: string) => {
    if (word.length === 4) maxPoints += 1;
    else maxPoints += word.length;
    
    if (data.pangrams.includes(word)) {
      maxPoints += 7;
    }
  });

  return {
    date: dateStr,
    centerLetter: data.centerLetter.toLowerCase(),
    outerLetters: data.outerLetters.map((l: string) => l.toLowerCase()),
    validWords: data.validWords.map((w: string) => w.toLowerCase()),
    pangrams: data.pangrams.map((w: string) => w.toLowerCase()),
    maxPoints
  };
}
