import { NextRequest } from 'next/server'

interface StyleResult {
  name: string
  description: string
  palette: string[]
  whatToAdd: string[]
  whatToChange: string[]
  products: { name: string; price: string; url: string }[]
}

interface SaveResultsPayload {
  email: string
  styles: StyleResult[]
  preferences: {
    aesthetic: string | null
    budget: string | null
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload: SaveResultsPayload = await request.json()

    if (!payload.email) {
      return Response.json({ error: 'Email is required' }, { status: 400 })
    }

    // Log the submission for now
    // In production, this would save to a database
    console.log('=== NEW STYLING RESULTS SUBMISSION ===')
    console.log('Email:', payload.email)
    console.log('Timestamp:', new Date().toISOString())
    console.log('Preferences:', JSON.stringify(payload.preferences, null, 2))
    console.log('Style Names:', payload.styles?.map(s => s.name).join(', '))
    console.log('Full Styles:', JSON.stringify(payload.styles, null, 2))
    console.log('======================================')

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error saving results:', error)
    return Response.json({ error: 'Failed to save results' }, { status: 500 })
  }
}
