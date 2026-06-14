import { NextRequest } from 'next/server'

// Allow generous time for image generation (gpt-image-1 medium is typically 15-25s)
export const maxDuration = 120

interface ParsedImage {
  buffer: Buffer
  mediaType: string
  ext: string
}

function parseDataUrl(dataUrl: string): ParsedImage | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null

  const mediaType = match[1]
  const buffer = Buffer.from(match[2], 'base64')

  // gpt-image-1 edits accepts png, jpeg and webp
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  }
  const ext = extMap[mediaType] ?? 'png'

  return { buffer, mediaType: extMap[mediaType] ? mediaType : 'image/png', ext }
}

export async function POST(request: NextRequest) {
  try {
    const { bedImage, itemImage } = await request.json()

    if (!bedImage || !itemImage) {
      return Response.json({ error: 'Both images are required' }, { status: 400 })
    }

    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
    }

    const bed = parseDataUrl(bedImage)
    const item = parseDataUrl(itemImage)
    if (!bed || !item) {
      return Response.json({ error: 'Invalid image format' }, { status: 400 })
    }

    const prompt =
      'Take the bedding or decor item shown in the SECOND image and place it naturally ' +
      'onto the bed in the FIRST image. Keep the first image\'s room, headboard, wall, ' +
      'lighting and camera perspective unchanged. Render the item with realistic drape, ' +
      'folds, scale, shadows and colour so it looks like a genuine photograph of that ' +
      'item actually on that bed. Photorealistic, natural interior lighting.'

    const formData = new FormData()
    formData.append('model', 'gpt-image-1')
    formData.append('prompt', prompt)
    formData.append('n', '1')
    formData.append('size', '1024x1024')
    formData.append('quality', 'medium')
    // Order matters: first image is the scene, second is the item to composite in.
    formData.append(
      'image[]',
      new Blob([bed.buffer], { type: bed.mediaType }),
      `bed.${bed.ext}`,
    )
    formData.append(
      'image[]',
      new Blob([item.buffer], { type: item.mediaType }),
      `item.${item.ext}`,
    )

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[match-composite] OpenAI error:', response.status, errorText)

      // Pull OpenAI's structured error so the real cause reaches the UI.
      let code = ''
      let message = ''
      try {
        const parsed = JSON.parse(errorText)
        code = parsed?.error?.code ?? ''
        message = parsed?.error?.message ?? ''
      } catch {
        // non-JSON body; fall through to status-based hint
      }

      let hint: string
      if (response.status === 403) {
        hint = 'Image model unavailable — the OpenAI organisation may need verification for gpt-image-1.'
      } else if (code === 'billing_hard_limit_reached' || message.includes('Billing hard limit')) {
        hint = 'OpenAI billing limit reached — add credit or raise the spend limit on the OpenAI account.'
      } else if (response.status === 401) {
        hint = 'OpenAI rejected the API key (401) — check OPENAI_API_KEY.'
      } else if (response.status === 429) {
        hint = 'OpenAI rate limit or no credit (429) — try again shortly or top up the account.'
      } else {
        hint = message || `Image generation failed (${response.status}).`
      }
      return Response.json({ error: hint }, { status: 502 })
    }

    const data = await response.json()
    const b64 = data?.data?.[0]?.b64_json
    if (!b64) {
      console.error('[match-composite] No image in response:', JSON.stringify(data).slice(0, 500))
      return Response.json({ error: 'No image returned from generator.' }, { status: 502 })
    }

    return Response.json({ compositeImage: `data:image/png;base64,${b64}` })
  } catch (error) {
    console.error('[match-composite] Error:', error)
    return Response.json({ error: 'Failed to generate preview image.' }, { status: 500 })
  }
}
