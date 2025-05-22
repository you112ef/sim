export type BlogPost = {
  id: string
  title: string
  description: string
  date: Date
  author: string
  authorRole: string
  avatar: string
  type: 'Agents' | 'Functions' | 'Workflows'
  readTime: string
  image?: string
  content: string
}

export const BLOG_POSTS: Record<string, BlogPost> = {
  'what-is-an-ai-agent': {
    id: 'what-is-an-ai-agent',
    title: 'What is an AI Agent, Anyway?',
    description:
      "Learn how to create a fully functional AI agent using SimStudio.ai's unified API and workflows.",
    date: new Date('2024-05-22'),
    author: 'Waleed Latif',
    authorRole: 'Founder',
    avatar: '/blog/waleed.png',
    type: 'Agents',
    readTime: '6',
    image: '/static/preview.png',
    content: `
      <h2>Introduction</h2>
      <p>Building an AI agent that can understand natural language, make decisions, and take actions used to require extensive engineering resources and expertise. With SimStudio.ai, you can build a fully functional agent in just a few steps.</p>
      
      <p>In this comprehensive guide, we'll walk through the process of creating an agent from scratch using SimStudio's intuitive workflow builder and unified API.</p>
      
      <h2>Step 1: Define Your Agent's Purpose</h2>
      <p>Before diving into the technical setup, clearly define what you want your agent to do. Is it a customer service assistant? A data analyst? A content creator? Knowing your agent's purpose will guide your implementation decisions.</p>
      
      <p>In SimStudio, you can create specialized agents for various domains, from simple chat assistants to complex workflow automation tools.</p>
      
      <h2>Step 2: Set Up Your Workflow</h2>
      <p>SimStudio's visual workflow builder makes it easy to design your agent's logic without writing code. Start by creating a new workflow and adding the necessary components:</p>
      
      <ul>
        <li>Input nodes for receiving user queries</li>
        <li>Processing nodes for analyzing and transforming data</li>
        <li>Decision nodes for branching logic</li>
        <li>Output nodes for returning responses</li>
      </ul>
      
      <h2>Step 3: Connect to External Tools</h2>
      <p>Enhance your agent's capabilities by connecting it to external tools and APIs. SimStudio offers pre-built integrations with popular services like:</p>
      
      <ul>
        <li>Database connectors</li>
        <li>File storage systems</li>
        <li>Communication platforms</li>
        <li>Analytics services</li>
      </ul>
      
      <p>These integrations allow your agent to fetch data, store information, and interact with other systems seamlessly.</p>
      
      <h2>Step 4: Test and Refine</h2>
      <p>Before deploying your agent, thoroughly test it to ensure it behaves as expected. SimStudio provides a built-in testing environment where you can:</p>
      
      <ul>
        <li>Simulate user interactions</li>
        <li>Debug workflow execution</li>
        <li>Monitor performance metrics</li>
        <li>Identify and fix issues</li>
      </ul>
      
      <p>Use this feedback to refine your agent's behavior, improve response quality, and optimize performance.</p>
      
      <h2>Step 5: Deploy and Scale</h2>
      <p>Once you're satisfied with your agent's performance, it's time to deploy it to production. SimStudio offers flexible deployment options:</p>
      
      <ul>
        <li>Managed cloud deployment</li>
        <li>Self-hosted solutions</li>
        <li>API integrations</li>
      </ul>
      
      <p>As your usage grows, you can easily scale your agent to handle increased traffic without sacrificing performance.</p>
      
      <h2>Conclusion</h2>
      <p>Building AI agents has never been more accessible thanks to platforms like SimStudio.ai. By following these five steps, you can create a powerful, intelligent agent tailored to your specific needs without extensive technical expertise.</p>
      
      <p>Ready to build your first agent? <a href="https://app.simstudio.ai">Sign up for SimStudio</a> today and start creating!</p>
    `,
  },
  'integrating-with-ollama': {
    id: 'integrating-with-ollama',
    title: 'Integrating with Ollama',
    description: 'Learn how to power your Sim Studio agents with Ollama.',
    date: new Date('2024-05-22'),
    author: 'Waleed Latif',
    authorRole: 'Founder',
    avatar: '/blog/waleed.png',
    type: 'Workflows',
    readTime: '10',
    image: '/blog/ollama.png',
    content: `
      <h2>Introduction</h2>
      <p>As your AI agents handle more complex tasks and serve more users, optimizing their performance becomes increasingly important. A well-optimized agent workflow not only responds faster but also consumes fewer resources, leading to better user experience and lower operational costs.</p>
      
      <p>In this in-depth guide, we'll explore techniques to optimize your SimStudio agent workflows for maximum efficiency and performance.</p>
    `,
  },
  'agent-memory': {
    id: 'agent-memory',
    title: 'Implementing Short-Term and Long-Term Memory in AI Agents',
    description:
      'How to build agents that remember context across multiple sessions using Sim Studio',
    date: new Date('2024-04-10'),
    author: 'Emir Karabeg',
    authorRole: 'CEO',
    avatar: '/blog/emir.png',
    type: 'Agents',
    readTime: '7',
    image: '/blog/memory.png',
    content: `
      <h2>Introduction</h2>
      <p>One of the most significant challenges in building effective AI agents is enabling them to remember information across multiple interactions. Without memory, agents are limited to handling isolated, stateless conversations, which severely restricts their usefulness for complex tasks.</p>
      
      <p>In this article, we'll explore how to implement long-term memory in your SimStudio agents, allowing them to maintain context, learn from past interactions, and provide a truly personalized experience.</p>
    `,
  },
}

export const getAllBlogPosts = (): BlogPost[] => {
  return Object.values(BLOG_POSTS).sort((a, b) => b.date.getTime() - a.date.getTime())
}

export const getBlogPostBySlug = (slug: string): BlogPost | undefined => {
  return BLOG_POSTS[slug]
}

export const getBlogPostsByType = (type: BlogPost['type']): BlogPost[] => {
  return getAllBlogPosts().filter((post) => post.type === type)
}

export const getRecentBlogPosts = (count: number = 6): BlogPost[] => {
  return getAllBlogPosts().slice(0, count)
}
