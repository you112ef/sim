import { useEffect, useState } from 'react'

export function useButtonStyle() {
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')

  useEffect(() => {
    const updateButtonClass = () => {
      if (typeof window === 'undefined') return

      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    updateButtonClass()

    window.addEventListener('resize', updateButtonClass)

    return () => {
      window.removeEventListener('resize', updateButtonClass)
    }
  }, [])

  return buttonClass
}
