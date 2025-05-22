'use client'

import { ReactNode } from 'react'
import NavWrapper from '../(landing)/components/nav-wrapper'

export default function BlogsLayout({ children }: { children: ReactNode }) {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className="bg-[#0C0C0C] min-h-screen font-geist-sans">
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />
      <div className="pt-24">{children}</div>
    </main>
  )
}
