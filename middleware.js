export const config = {
  matcher: '/(.*)',
}

export default function middleware(request) {
  const password = process.env.DASHBOARD_PASSWORD
  if (!password) return new Response(null, { status: 500, statusText: 'DASHBOARD_PASSWORD not set' })

  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ')
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded)
      const colonIndex = decoded.indexOf(':')
      const providedPassword = decoded.slice(colonIndex + 1)
      if (providedPassword === password) return new Response(null, { status: 200 })
    }
  }

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="iExec Dashboard"',
    },
  })
}
