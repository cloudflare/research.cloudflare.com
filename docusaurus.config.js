const path = require('path');

const math = require('remark-math')
const katex = require('rehype-katex')

const lightCodeTheme = require('prism-react-renderer/themes/duotoneLight');
const darkCodeTheme = require('prism-react-renderer/themes/okaidia');

    
/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: 'Cloudflare Research',
  tagline: 'Building a better Internet through experimentation and fundamental computer science',
  url: 'https://research.cloudflare.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'cloudflare', // Usually your GitHub org/user name.
  projectName: 'research.cloudflare.com', // Usually your repo name.
  stylesheets: [
    { 
      href: "https://cdn.jsdelivr.net/npm/katex@0.13.11/dist/katex.min.css",
      integrity: "sha384-Um5gpz1odJg5Z4HAmzPtgZKdTBHZdw8S29IecapCSB31ligYPhHQZMIlWLYQGVoc",
      crossorigin: "anonymous"
    }
  ],
  themeConfig: {
    navbar: {
      title: 'Cloudflare Research',
      logo: {
        alt: 'Cloudflare logo',
        src: 'img/cloud.svg',
      },
      items: [
        {
          to: '/approach',
          label: 'Approach',
          position: 'left' 
        },
        {
          type: 'doc',
          docId: 'odns',
          label: 'Projects',
          position: 'left' 
        },
        {
          to: '/people',
          label: 'People',
          position: 'left'
        },        
        {
          href: 'https://blog.cloudflare.com',
          label: 'Updates',
          position: 'left'
        },
        /*{
          href: 'https://github.com/cloudflare/research.cloudflare.com',
          label: 'GitHub',
          position: 'right',
        },*/
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Cloudflare`,
    },
    prism: {
      additionalLanguages: [ 'rust' ],
      theme: lightCodeTheme,
      darkTheme: darkCodeTheme,
    },
  },
  plugins: [
    path.resolve(__dirname, 'src/plugins/people'),
    path.resolve(__dirname, 'src/plugins/projects'),
  ],
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          editUrl:
            'https://github.com/cloudflare/research.cloudflare.com/edit/master/website/',
          remarkPlugins: [math],
          rehypePlugins: [katex],
          sidebarItemsGenerator: async function ({
            defaultSidebarItemsGenerator,
            ...args
          }) {          
            let sidebarItems = await defaultSidebarItemsGenerator(args);
            //sidebarItems = sidebarItems.filter( (item) => item.id != 'overview' );
            return sidebarItems;
          },
        },
        blog: {
          path: 'updates',
          blogTitle: 'Updates',
          routeBasePath: 'updates',
          showReadingTime: true,
          editUrl:
            'https://github.com/facebook/docusaurus/edit/master/website/blog/',
          blogSidebarTitle: 'Recent updates',
        },
        pages: {
          remarkPlugins: [math],
          rehypePlugins: [katex],
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};
