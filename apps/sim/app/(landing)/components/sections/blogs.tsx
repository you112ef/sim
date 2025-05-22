'use client'

import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getRecentBlogPosts } from '@/app/blogs/data'
import { BlogCard } from '../blog-card'

function Blogs() {
  const featuredBlogs = getRecentBlogPosts(6)

  return (
    <motion.section
      className="flex flex-col py-20 w-full gap-16 px-8 md:px-16 lg:px-28 xl:px-32"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay: 0.01, ease: 'easeOut' }}
    >
      <div className="flex flex-col gap-7">
        <motion.p
          className="text-white font-medium tracking-normal text-5xl"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          Insights for building
          <br />
          smarter Agents
        </motion.p>
        <motion.p
          className="text-white/60 text-xl tracking-normal max-w-md font-light"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          Stay ahead with the latest tips, updates, and best practices for AI agent development.
        </motion.p>
      </div>

      <div className="w-full flex flex-col gap-12 md:grid md:grid-cols-2 lg:grid-cols-3 md:grid-rows-1">
        <motion.div
          className="flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
        >
          {featuredBlogs.length > 0 && (
            <BlogCard
              key={featuredBlogs[0].id}
              href={`/blogs/${featuredBlogs[0].id}`}
              title={featuredBlogs[0].title}
              description={featuredBlogs[0].description}
              date={featuredBlogs[0].date}
              author={featuredBlogs[0].author}
              authorRole={featuredBlogs[0].authorRole}
              avatar={featuredBlogs[0].avatar}
              type={featuredBlogs[0].type}
              readTime={featuredBlogs[0].readTime}
            />
          )}
          {featuredBlogs.length > 1 && (
            <BlogCard
              key={featuredBlogs[1].id}
              href={`/blogs/${featuredBlogs[1].id}`}
              title={featuredBlogs[1].title}
              description={featuredBlogs[1].description}
              date={featuredBlogs[1].date}
              author={featuredBlogs[1].author}
              authorRole={featuredBlogs[1].authorRole}
              avatar={featuredBlogs[1].avatar}
              type={featuredBlogs[1].type}
              readTime={featuredBlogs[1].readTime}
            />
          )}
        </motion.div>
        <motion.div
          className="flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.22, ease: 'easeOut' }}
        >
          {featuredBlogs.length > 2 && (
            <BlogCard
              key={featuredBlogs[2].id}
              href={`/blogs/${featuredBlogs[2].id}`}
              title={featuredBlogs[2].title}
              description={featuredBlogs[2].description}
              date={featuredBlogs[2].date}
              author={featuredBlogs[2].author}
              authorRole={featuredBlogs[2].authorRole}
              avatar={featuredBlogs[2].avatar}
              type={featuredBlogs[2].type}
              readTime={featuredBlogs[2].readTime}
              image={featuredBlogs[2].image}
            />
          )}
          {featuredBlogs.length > 3 && (
            <BlogCard
              key={featuredBlogs[3].id}
              href={`/blogs/${featuredBlogs[3].id}`}
              title={featuredBlogs[3].title}
              description={featuredBlogs[3].description}
              author={featuredBlogs[3].author}
              authorRole={featuredBlogs[3].authorRole}
              avatar={featuredBlogs[3].avatar}
              type={featuredBlogs[3].type}
              readTime={featuredBlogs[3].readTime}
            />
          )}
        </motion.div>
        <motion.div
          className="hidden lg:flex flex-col gap-12"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.26, ease: 'easeOut' }}
        >
          {featuredBlogs.length > 4 && (
            <BlogCard
              key={featuredBlogs[4].id}
              href={`/blogs/${featuredBlogs[4].id}`}
              title={featuredBlogs[4].title}
              description={featuredBlogs[4].description}
              date={featuredBlogs[4].date}
              author={featuredBlogs[4].author}
              authorRole={featuredBlogs[4].authorRole}
              avatar={featuredBlogs[4].avatar}
              type={featuredBlogs[4].type}
              readTime={featuredBlogs[4].readTime}
            />
          )}
          {featuredBlogs.length > 5 && (
            <BlogCard
              key={featuredBlogs[5].id}
              href={`/blogs/${featuredBlogs[5].id}`}
              title={featuredBlogs[5].title}
              description={featuredBlogs[5].description}
              date={featuredBlogs[5].date}
              author={featuredBlogs[5].author}
              authorRole={featuredBlogs[5].authorRole}
              avatar={featuredBlogs[5].avatar}
              type={featuredBlogs[5].type}
              readTime={featuredBlogs[5].readTime}
            />
          )}
        </motion.div>
      </div>

      <div className="flex justify-center mt-4">
        <Link
          href="/blogs"
          className="px-5 py-2 border border-white/20 rounded-full text-white hover:bg-white/10 transition-colors text-lg"
        >
          View all articles
        </Link>
      </div>
    </motion.section>
  )
}

export default Blogs
