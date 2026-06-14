export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')

  if (!query) {
    return Response.json({ error: 'Query parameter required' }, { status: 400 })
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY

  if (!accessKey) {
    // Fallback to Picsum if no API key
    const seed = query.toLowerCase().replace(/[^\w\s]/g, '').split(' ').slice(0, 4).join('-')
    return Response.json({ url: `https://picsum.photos/seed/${seed}/200/200` })
  }

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&client_id=${accessKey}`,
      { next: { revalidate: 86400 } } // Cache for 24 hours
    )

    if (!response.ok) {
      throw new Error(`Unsplash API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.results && data.results.length > 0) {
      return Response.json({ 
        url: data.results[0].urls.small,
        alt: data.results[0].alt_description || query
      })
    }

    // Fallback to Picsum if no results
    const seed = query.toLowerCase().replace(/[^\w\s]/g, '').split(' ').slice(0, 4).join('-')
    return Response.json({ url: `https://picsum.photos/seed/${seed}/200/200` })

  } catch (error) {
    console.error('Unsplash fetch error:', error)
    // Fallback to Picsum on error
    const seed = query.toLowerCase().replace(/[^\w\s]/g, '').split(' ').slice(0, 4).join('-')
    return Response.json({ url: `https://picsum.photos/seed/${seed}/200/200` })
  }
}
