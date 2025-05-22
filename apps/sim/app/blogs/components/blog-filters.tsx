'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

type CategoryFilter = 'all' | 'agents' | 'functions' | 'workflows'

const BlogFilters = () => {
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all')

  const handleFilterChange = (filter: CategoryFilter) => {
    setActiveFilter(filter)
    // In a real implementation, this would filter the blog posts
  }

  return (
    <div className="w-full">
      <motion.div
        className="flex flex-wrap gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <FilterButton
          label="All Categories"
          active={activeFilter === 'all'}
          onClick={() => handleFilterChange('all')}
        />
        <FilterButton
          label="Agents"
          active={activeFilter === 'agents'}
          onClick={() => handleFilterChange('agents')}
          color="#802efc"
        />
        <FilterButton
          label="Functions"
          active={activeFilter === 'functions'}
          onClick={() => handleFilterChange('functions')}
          color="#FC2E31"
        />
        <FilterButton
          label="Workflows"
          active={activeFilter === 'workflows'}
          onClick={() => handleFilterChange('workflows')}
          color="#2E8CFC"
        />
      </motion.div>
    </div>
  )
}

interface FilterButtonProps {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}

const FilterButton = ({ label, active, onClick, color }: FilterButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
        active ? 'shadow-sm' : 'hover:bg-white/5'
      }`}
      style={
        active && color
          ? { backgroundColor: color, color: 'white' }
          : {
              backgroundColor: active ? '#ffffff0a' : 'transparent',
              color: active ? 'white' : '#bbbbbb',
            }
      }
    >
      {label}
    </button>
  )
}

export default BlogFilters
