interface Product {
  name: string
  price: string
  url: string
}

interface StyleResult {
  name: string
  description: string
  palette: string[]
  whatToAdd: string[]
  whatToChange: string[]
  products: Product[]
}

interface AnalysisResult {
  styles: StyleResult[]
}

interface Preferences {
  aesthetic: 'minimal' | 'coastal' | 'cosy' | 'luxe' | 'boho' | null
  budget: 'under-100' | '100-250' | '250-500' | '500-plus' | null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { image, preferences } = body as { image: string; preferences?: Preferences }

    if (!image) {
      return Response.json({ error: 'No image provided' }, { status: 400 })
    }

    // Extract base64 data and media type from the data URL
    const matches = image.match(/^data:(.+);base64,(.+)$/)
    if (!matches) {
      return Response.json({ error: 'Invalid image format' }, { status: 400 })
    }

    const mediaType = matches[1]
    const base64Data = matches[2]

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const systemPrompt = `You are an expert interior designer and bedding stylist with a sharp eye for detail. You analyze SPECIFIC beds - not generic bedrooms. You must respond with valid JSON only - no markdown, no code blocks, no additional text.

CRITICAL INSTRUCTIONS:
1. OBSERVE THE ACTUAL PHOTO: Reference specific details you can see - the exact colors of the current bedding, the headboard style, visible pillows, any patterns, the lighting quality, wall colors, and any decor items.
2. STYLE NAMES: Create evocative, unique names that feel editorial and specific - NOT generic categories like "Warm Minimalism" or "Coastal Calm". Think "Dusty Olive & Oatmeal", "Rumpled Sunday Morning", "Quiet Storm", "Terracotta Dreams", "Fog & Linen" - names that paint a picture.
3. DESCRIPTIONS: Write as if you're a real stylist who just looked at THIS bed. Reference what you actually see: "I notice your current white duvet creates a blank canvas, but the warm oak headboard is begging for earthy tones to complement it..."
4. PRODUCT SPECIFICS: Every product must include exact details:
   - Size (king, queen, euro, lumbar)
   - Material (stonewashed linen, brushed cotton, Belgian flax, washed percale)
   - Exact color (dusty sage, warm clay, fog grey, natural oat - not just "blue" or "green")
   - Example: "King-sized stonewashed linen duvet cover in dusty olive" NOT "linen duvet"
5. WHAT TO ADD/CHANGE: Be specific to THIS bed. Reference items you can actually see that should be kept, moved, or removed.

Your response must be a JSON object with this exact structure:
{
  "styles": [
    {
      "name": "Evocative Style Name",
      "description": "2-3 sentences referencing specific details from the photo and explaining the vision.",
      "palette": ["#HEXCODE1", "#HEXCODE2", "#HEXCODE3", "#HEXCODE4"],
      "whatToAdd": ["Specific item with size, material, exact color", "...", "..."],
      "whatToChange": ["Specific change referencing what you see", "..."],
      "products": [
        { "name": "Brand + specific item with size/material/color", "price": "$XXX", "url": "#" },
        { "name": "Brand + specific item with size/material/color", "price": "$XXX", "url": "#" },
        { "name": "Brand + specific item with size/material/color", "price": "$XXX", "url": "#" }
      ]
    }
  ]
}

Always provide exactly 3 styles. Make each feel like a real stylist's recommendation for THIS specific bed.`

    // Build personalized prompt based on quiz answers
    const aestheticMap: Record<string, string> = {
      'minimal': 'clean minimalist with simple lines and neutral tones',
      'coastal': 'coastal and beachy with soft blues, whites, and natural textures',
      'cosy': 'warm and cosy with rich textures, warm tones, and inviting layers',
      'luxe': 'luxurious and hotel-inspired with premium fabrics and sophisticated styling',
      'boho': 'bohemian with eclectic patterns, natural materials, and artistic flair',
    }

    const budgetMap: Record<string, string> = {
      'under-100': 'budget-friendly options under $150 NZD total',
      '100-250': 'mid-range options between $150-$400 NZD total',
      '250-500': 'premium options between $400-$800 NZD total',
      '500-plus': 'luxury options over $800 NZD, featuring the finest materials',
    }

    const aestheticPref = preferences?.aesthetic ? aestheticMap[preferences.aesthetic] : 'varied aesthetics'
    const budgetPref = preferences?.budget ? budgetMap[preferences.budget] : 'a range of price points'

    const userPrompt = `Look carefully at this specific bed and provide 3 personalized styling recommendations.

USER PREFERENCES:
- Their aesthetic vibe: ${aestheticPref}
- Budget for new items: ${budgetPref}

FIRST, observe and mentally note:
- What color is the current bedding? What material does it look like?
- What's the headboard style? Wood, upholstered, metal, or none?
- How many pillows are there? What sizes and arrangement?
- What's the lighting like? Warm, cool, bright, moody?
- Any visible decor, nightstands, wall color, or textures?
- What's working well? What feels off or unfinished?

THEN, create 3 styling directions that:
1. Work with what's already there (keep the headboard color, complement existing tones)
2. Are tailored to their ${preferences?.aesthetic || 'desired'} aesthetic preference
3. Stay within ${budgetPref}

For style names, be evocative and specific - imagine these as editorial magazine headlines:
- Good: "Sage & Stone", "Rumpled Linen Mornings", "Desert at Dusk", "Cloud Layers"  
- Bad: "Minimalist Style", "Cozy Look", "Modern Bedroom"

For descriptions, reference what you SEE:
- Good: "Your warm oak headboard pairs beautifully with earthy tones - I'd lean into that with..."
- Bad: "This style features neutral colors and clean lines..."

For products, be extremely specific:
- Good: "Parachute Linen Duvet Cover in Moss, Queen" at $249
- Bad: "Green linen duvet" at $200

Use real premium brands: Parachute, Brooklinen, Boll & Branch, Coyuchi, Snowe, Cultiver, Matteo, Piglet in Bed.

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
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
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
        { error: `Anthropic API error: ${response.status}. Please try again.` },
        { status: 500 }
      )
    }

    const data = await response.json()
    console.log('[v0] Raw Anthropic response:', JSON.stringify(data, null, 2).substring(0, 500))
    
    // Extract the text content from Claude's response
    const textContent = data.content?.find((block: { type: string }) => block.type === 'text')
    if (!textContent || !textContent.text) {
      console.error('[v0] No text content in response:', JSON.stringify(data))
      return Response.json({ error: 'No response from AI. Please try again.' }, { status: 500 })
    }

    console.log('[v0] Raw text from Claude:', textContent.text.substring(0, 300))

    // Parse the JSON response
    let analysisResult: AnalysisResult
    try {
      // Clean up the response in case it has markdown code blocks
      let jsonText = textContent.text.trim()
      
      // Remove markdown code fences (```json ... ``` or ``` ... ```)
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim()
      } else {
        // Also handle if it starts with ``` but doesn't have closing
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.slice(7).trim()
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.slice(3).trim()
        }
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.slice(0, -3).trim()
        }
      }
      
      // Try to find JSON object if there's text before/after
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
      if (jsonObjectMatch) {
        jsonText = jsonObjectMatch[0]
      }
      
      console.log('[v0] Cleaned JSON to parse:', jsonText.substring(0, 200))
      
      analysisResult = JSON.parse(jsonText)
      
      if (!analysisResult.styles || !Array.isArray(analysisResult.styles)) {
        throw new Error('Response missing styles array')
      }
    } catch (parseError) {
      console.error('[v0] Failed to parse Claude response:', parseError)
      console.error('[v0] Raw text was:', textContent.text)
      return Response.json({ 
        error: 'Failed to parse AI response. The AI may have returned an invalid format. Please try again.' 
      }, { status: 500 })
    }

    return Response.json({ styles: analysisResult.styles })
  } catch (error) {
    console.error('Error analyzing bed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Response.json(
      { error: `Failed to analyze image: ${errorMessage}` },
      { status: 500 }
    )
  }
}
