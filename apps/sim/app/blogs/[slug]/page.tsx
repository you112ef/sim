'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { getBlogPostBySlug } from '@/app/blogs/data'

export default function BlogPost() {
  const { slug } = useParams() as { slug: string }
  const post = getBlogPostBySlug(slug as string)

  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  if (!post) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8 min-h-screen">
        <h1 className="text-4xl font-bold mb-4">Blog Post Not Found</h1>
        <p className="text-xl mb-8">
          The blog post you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/blogs"
          className="bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition-colors"
        >
          Back to All Blogs
        </Link>
      </div>
    )
  }

  return (
    <div className="pb-20">
      {/* Hero Section */}
      <motion.div
        className="w-full max-w-5xl mx-auto px-6 md:px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-col items-start gap-6 mb-12">
          <Link
            href="/blogs"
            className="text-white/60 hover:text-white flex items-center gap-2 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to All Blogs
          </Link>

          <div
            className="px-4 py-1 rounded-lg bg-[#802efc] inline-block"
            style={{
              backgroundColor:
                post.type === 'Agents'
                  ? '#802efc'
                  : post.type === 'Functions'
                    ? '#FC2E31'
                    : '#2E8CFC',
            }}
          >
            <p className="text-white text-sm">{post.type}</p>
          </div>

          <h1 className="text-4xl md:text-5xl font-semibold text-white leading-tight">
            {post.title}
          </h1>

          <div className="flex items-center gap-4 mt-2">
            <Image
              src={post.avatar}
              alt={post.author}
              width={48}
              height={48}
              className="rounded-full"
            />
            <div>
              <p className="text-white font-medium">{post.author}</p>
              <p className="text-white/60 text-sm">{post.authorRole}</p>
            </div>
            <div className="h-6 w-px bg-white/20 mx-2" />
            <p className="text-white/60 text-sm">
              {post.date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <div className="h-6 w-px bg-white/20 mx-2" />
            <p className="text-white/60 text-sm">{post.readTime} min read</p>
          </div>
        </div>

        {post.image && (
          <div className="w-full aspect-video relative rounded-xl overflow-hidden mb-16">
            <Image src={post.image} alt={post.title} fill className="object-cover" />
          </div>
        )}

        {/* Blog Content */}
        <motion.div
          className="prose prose-invert max-w-3xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* Share and Actions */}
        <div className="max-w-3xl mx-auto mt-16 border-t border-white/10 pt-8">
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <button className="text-white/70 hover:text-white transition-colors">
                Share on Twitter
              </button>
              <button className="text-white/70 hover:text-white transition-colors">
                Share on LinkedIn
              </button>
            </div>
            <Link href="/blogs" className="text-white/70 hover:text-white transition-colors">
              More Articles
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
