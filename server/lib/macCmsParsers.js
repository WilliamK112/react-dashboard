function tryParseJsonObject(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function extractMacPlayerInfo(html) {
  const patterns = [
    /mac_player_info\s*=\s*(\{[\s\S]*?\})\s*;/,
    /mac_player_info\s*=\s*(\{[\s\S]*?\})\s*<\/script>/,
    /mac_player_info\s*=\s*(\{[\s\S]*?\})\s*</,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      const parsed = tryParseJsonObject(match[1])
      if (parsed) return parsed
    }
  }

  return null
}

export function extractTokenFromHtml(html) {
  const patterns = [
    /token\s*[:=]\s*["']([^"']+)["']/i,
    /["']token["']\s*:\s*["']([^"']+)["']/i,
    /name=["']token["'][^>]*value=["']([^"']+)["']/i,
    /["']token["']\s*,\s*["']([^"']+)["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

export function parseResolveApiResponse(payload) {
  const data = typeof payload === 'string' ? tryParseJsonObject(payload) : payload
  if (!data || typeof data !== 'object') return null
  const resolved = data?.data?.url
  if (!resolved || typeof resolved !== 'string') return null
  return resolved
}

export function shouldTriggerFallback(primary) {
  if (!primary) return false
  const output = (primary.output || '').toLowerCase()
  const failed = primary.code !== 0
  if (!failed) return false
  return (
    output.includes('unsupported') ||
    output.includes('no source') ||
    output.includes('unable to extract') ||
    output.includes('unable to download') ||
    output.includes('http error') ||
    output.includes('timed out') ||
    output.includes('connection reset') ||
    output.includes('connection broken') ||
    output.includes('error reading response') ||
    output.includes('transport error') ||
    output.includes('geo restriction') ||
    output.includes('not available from your location') ||
    output.includes('requested format is not available')
  )
}
