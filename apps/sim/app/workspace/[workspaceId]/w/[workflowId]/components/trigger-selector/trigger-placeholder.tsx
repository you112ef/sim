'use client'

import { Plus, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TriggerPlaceholderProps {
  onClick: () => void
  className?: string
}

export function TriggerPlaceholder({ onClick, className }: TriggerPlaceholderProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center pointer-events-none',
        className
      )}
    >
      <button
        onClick={onClick}
        className={cn(
          'relative group pointer-events-auto',
          'w-64 h-32 rounded-xl',
          'border-2 border-dashed border-muted-foreground/30',
          'bg-background/50 backdrop-blur-sm',
          'transition-all duration-300 ease-out',
          'hover:border-primary/50 hover:bg-background/80',
          'hover:shadow-lg hover:scale-[1.02]',
          'active:scale-[0.98]',
          'cursor-pointer'
        )}
      >
        <div className='flex flex-col items-center justify-center h-full px-4'>
          <div className='relative mb-2'>
            <Zap className='w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors' />
            <Plus className='absolute -bottom-1 -right-1 w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity' />
          </div>

          <p className='text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors'>
            Click to Add Trigger
          </p>
        </div>

        {/* Animated corner accents */}
        <div className='absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/50 rounded-tl-md opacity-0 group-hover:opacity-100 transition-opacity' />
        <div className='absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary/50 rounded-tr-md opacity-0 group-hover:opacity-100 transition-opacity' />
        <div className='absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary/50 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity' />
        <div className='absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary/50 rounded-br-md opacity-0 group-hover:opacity-100 transition-opacity' />
      </button>
    </div>
  )
}
