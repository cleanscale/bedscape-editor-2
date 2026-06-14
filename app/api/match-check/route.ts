import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { bedImage, itemImage } = await request.json()

    if (!bedImage || !itemImage) {
      return Response.json({ error: 'Both images are required' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      // Dev-only fallback: with no Anthropic key, return a stub verdict so the
      // composite-image feature can still be tested end-to-end. Never stubs in production.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[match-check] No ANTHROPIC_API_KEY — returning stub verdict (dev only).')
        return Response.json({
          verdict: 'could-work',
          explanation:
            '[Dev stub — no Anthropic key set] This is a placeholder verdict so the composite preview can be tested. Add ANTHROPIC_API_KEY for the real analysis.',
        })
      }
      return Response.json({ error: 'API key not configured' }, { status: 500 })
    }

    // Extract base64 data from both images
    const bedBase64 = bedImage.split(',')[1]
    const itemBase64 = itemImage.split(',')[1]
    
    const bedMediaType = bedImage.match(/data:([^;]+);/)?.[1] || 'image/jpeg'
    const itemMediaType = itemImage.match(/data:([^;]+);/)?.[1] || 'image/jpeg'

    const systemPrompt = `You are an expert interior designer and colour consultant. You help people decide if a bedding item or decor piece will work with their existing bed setup.

You MUST respond with valid JSON only - no markdown, no code blocks, no additional text.

Your response must be a JSON object with this exact structure:
{
  "verdict": "works-beautifully" | "could-work" | "doesnt-work",
  "explanation": "2-3 sentences explaining why"
}

Verdicts:
- "works-beautifully": The colours, textures, and style complement each other well. This would be a confident purchase.
- "could-work": It's not a perfect match but could work with some adjustments or additional pieces to tie it together.
- "doesnt-work": The colours clash, styles conflict, or it would look out of place. Not recommended.

Be specific in your explanation - reference actual colours, patterns, and textures you can see in both images. Be honest but kind.`

    const userPrompt = `Look at these two images:
1. The first image is someone's bed at home
2. The second image is a bedding item or decor piece they're considering buying

Analyse whether the item in the second image would work well with the existing bed setup in the first image. Consider:
- Colour harmony (do the colours complement or clash?)
- Texture compatibility (do the materials work together?)
- Style consistency (does it fit the existing aesthetic?)

Respond with JSON only.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: bedMediaType,
                  data: bedBase64,
                },
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: itemMediaType,
                  data: itemBase64,
                },
              },
              {
                type: 'text',
                text: userPrompt,
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('[v0] Anthropic API error:', response.status, errorData)
      return Response.json(
        { error: `Analysis failed (${response.status}). Please try again.` },
        { status: 500 }
      )
    }

    const data = await response.json()
    
    const textContent = data.content?.find((block: { type: string }) => block.type === 'text')
    if (!textContent || !textContent.text) {
      console.error('[v0] No text content in response:', JSON.stringify(data))
      return Response.json({ error: 'No response from AI. Please try again.' }, { status: 500 })
    }

    // Parse the JSON response
    let result
    try {
      let jsonText = textContent.text.trim()
      
      // Remove markdown code fences
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim()
      }
      
      // Try to find JSON object
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
      if (jsonObjectMatch) {
        jsonText = jsonObjectMatch[0]
      }
      
      result = JSON.parse(jsonText)
      
      if (!result.verdict || !result.explanation) {
        throw new Error('Response missing required fields')
      }
      
      // Validate verdict
      const validVerdicts = ['works-beautifully', 'could-work', 'doesnt-work']
      if (!validVerdicts.includes(result.verdict)) {
        result.verdict = 'could-work' // Default to middle ground if invalid
      }
    } catch (parseError) {
      console.error('[v0] Failed to parse response:', parseError)
      console.error('[v0] Raw text was:', textContent.text)
      return Response.json({ 
        error: 'Failed to parse AI response. Please try again.' 
      }, { status: 500 })
    }

    return Response.json(result)
  } catch (error) {
    console.error('[v0] Match check error:', error)
    return Response.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}
