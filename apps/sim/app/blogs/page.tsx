'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getAllBlogPosts } from '@/app/blogs/data'
import BlogFilters from './components/blog-filters'

export default function BlogsPage() {
  const blogPosts = getAllBlogPosts()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="w-full max-w-7xl mx-auto py-16 md:py-20 px-6 md:px-8">
        <motion.div
          className="max-w-3xl"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          <h1 className="text-4xl md:text-5xl font-semibold mb-6 leading-tight">
            Insights for building
            <br />
            smarter Agents
          </h1>
          <p className="text-lg text-white/70 max-w-2xl">
            Stay ahead with the latest tips, updates, and best practices for AI agent development.
          </p>
        </motion.div>

        <motion.div
          className="mt-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <BlogFilters />
        </motion.div>
      </section>

      {/* Blog List */}
      <section className="w-full max-w-7xl mx-auto pb-20 px-6 md:px-8">
        <div className="flex flex-col gap-10">
          {blogPosts.map((post, index) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 + index * 0.05 }}
              className="w-full"
            >
              <Link href={`/blogs/${post.id}`} className="block group">
                <div className="bg-[#fafafa]/[0.03] hover:bg-[#ffffff]/[0.05] border border-[#ffffff]/[0.1] rounded-xl overflow-hidden transition-all duration-300">
                  <div className="flex flex-col md:flex-row">
                    <div className="flex-1 p-6 md:p-8 flex flex-col justify-between">
                      <div className="space-y-4">
                        {/* Category tags */}
                        <div className="flex flex-wrap gap-2">
                          <span className="uppercase text-xs tracking-wider font-medium text-[#bbbbbb]">
                            {post.type}
                          </span>
                        </div>

                        {/* Title */}
                        <h2 className="text-2xl md:text-3xl font-semibold group-hover:text-white transition-colors duration-200 text-white/90">
                          {post.title}
                        </h2>

                        {/* Description */}
                        <p className="text-[#bbbbbb] text-base line-clamp-2">{post.description}</p>
                      </div>

                      <div className="mt-6 flex items-center justify-between">
                        {/* Author info */}
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full overflow-hidden">
                            <Image
                              src={post.avatar}
                              alt={post.author}
                              width={32}
                              height={32}
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white/90">{post.author}</p>
                            <p className="text-xs text-white/60">
                              {post.date.toLocaleDateString('en-US', {
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </p>
                          </div>
                        </div>

                        {/* Read more */}
                        <div className="text-sm flex items-center gap-1 text-white/80 group-hover:text-white group-hover:translate-x-1 transition-all duration-200">
                          <span>Read more</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Image */}
                    {post.image && (
                      <div className="md:w-1/3 h-48 md:h-auto">
                        <div className="h-full w-full relative">
                          <Image src={post.image} alt={post.title} fill className="object-cover" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  )
}
