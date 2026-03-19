import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const res = NextResponse.next()
  
  // Supabase salva il token di accesso nei cookie del browser.
  // Cerchiamo se esiste un cookie di autenticazione di Supabase.
  const hasAuthCookie = req.cookies.getAll().some(c => c.name.includes('-auth-token'))

  const isLoginPage = req.nextUrl.pathname.startsWith('/login')

  // Se l'utente NON ha il cookie e NON è sulla pagina di login, lo mandiamo al login
  if (!hasAuthCookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Se l'utente ha il cookie (è loggato) e prova ad andare sul login, lo rimandiamo alla dashboard
  if (hasAuthCookie && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

// Diciamo al middleware di controllare tutte le pagine TRANNE le immagini, i file di sistema e le API
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}