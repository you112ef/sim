'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams, usePathname, useRouter } from 'next/navigation'

const languages = {
  en: { name: 'English', flag: '🇺🇸' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  zh: { name: '简体中文', flag: '🇨🇳' },
}

export function LanguageDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const [currentLang, setCurrentLang] = useState('en')

  // Detect current language from params or URL
  useEffect(() => {
    // First try to get language from params (Next.js route params)
    const langFromParams = params?.lang as string

    if (langFromParams && Object.keys(languages).includes(langFromParams)) {
      if (langFromParams !== currentLang) {
        setCurrentLang(langFromParams)
      }
      return
    }

    // Fallback to pathname parsing
    const segments = pathname.split('/').filter(Boolean)
    const firstSegment = segments[0]

    if (firstSegment && Object.keys(languages).includes(firstSegment)) {
      if (firstSegment !== currentLang) {
        setCurrentLang(firstSegment)
      }
    } else {
      if (currentLang !== 'en') {
        setCurrentLang('en') // Default to English
      }
    }
  }, [pathname, params, currentLang])

  const handleLanguageChange = (locale: string) => {
    if (locale === currentLang) {
      setIsOpen(false)
      return // Don't navigate if same language
    }

    setIsOpen(false)

    // Get the current route without language prefix
    const segments = pathname.split('/').filter(Boolean)

    // Remove current locale from path if present
    if (segments[0] && Object.keys(languages).includes(segments[0])) {
      segments.shift() // Remove first segment (current locale)
    }

    // Build new path with new locale
    let newPath = ''
    if (locale === 'en') {
      // For default locale (English), no prefix
      newPath = segments.length > 0 ? `/${segments.join('/')}` : '/introduction'
    } else {
      // For non-default locales, add prefix
      newPath = `/${locale}${segments.length > 0 ? `/${segments.join('/')}` : '/introduction'}`
    }

    // Force a hard navigation to ensure the middleware processes it
    window.location.href = newPath
  }

  return (
    <div className='relative'>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          console.log('Dropdown button clicked, current state:', isOpen)
          setIsOpen(!isOpen)
        }}
        className='flex items-center gap-2 rounded-xl border border-border/20 bg-muted/50 px-3 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-muted'
      >
        <span className='text-base'>{languages[currentLang as keyof typeof languages]?.flag}</span>
        <span className='font-medium text-foreground'>
          {languages[currentLang as keyof typeof languages]?.name}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className='fixed inset-0 z-10' onClick={() => setIsOpen(false)} />
          <div className='absolute top-full left-0 z-20 mt-1 w-48 rounded-lg border border-border/50 bg-background/95 shadow-xl backdrop-blur-md'>
            {Object.entries(languages).map(([code, lang]) => (
              <button
                key={code}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('Language option clicked:', code, 'current:', currentLang)
                  handleLanguageChange(code)
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/80 ${
                  currentLang === code ? 'bg-muted/60 font-medium text-primary' : 'text-foreground'
                }`}
              >
                <span className='text-base'>{lang.flag}</span>
                <span>{lang.name}</span>
                {currentLang === code && <Check className='ml-auto h-4 w-4 text-primary' />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
