const fs = require( 'fs' )
const path = require( 'path' )

const markdownIt = require( 'markdown-it' )
const markdownItAnchor = require( 'markdown-it-anchor' )
const markdownItLinkAttributes = require( 'markdown-it-link-attributes' )

const syntaxHighlight = require( '@11ty/eleventy-plugin-syntaxhighlight' )
const tableOfContents = require( 'eleventy-plugin-toc' )

const katex = require( 'katex' )
const yaml = require( 'js-yaml' )


module.exports = function( eleventyConfig ) {
  
  // This will copy these folders to the output without modifying them at all
  eleventyConfig.addPassthroughCopy( 'js' )
  eleventyConfig.addPassthroughCopy( 'img' )
  eleventyConfig.addPassthroughCopy( 'css' )
  eleventyConfig.addPassthroughCopy( '_redirects' )
  
  // handle LaTeX
  eleventyConfig.addFilter( 'latex', content => {
    return content.replace( /\$\$(.+?)\$\$/g, ( _, equation ) => {
      const cleanEquation = equation
        .replace( /&lt;/g, '<' )
        .replace( /&gt;/g, '>' )

      return katex.renderToString( cleanEquation, { throwOnError: true } )
    })
  })

  // add markdown header anchors and a table of contents
  let markdown = markdownIt( {
        html: true,
        breaks: true,
        linkify: true
    } )
    .use( markdownItAnchor )
    .use( markdownItLinkAttributes, [ {
      pattern: /^(?!(\/|#)).*$/gm,
      attrs: {
        target: '_blank',
        rel: 'noopener'
      }
    } ] )

  eleventyConfig.setLibrary( 'md', markdown );
  
  // enable plugins
  eleventyConfig.addPlugin( syntaxHighlight )
  eleventyConfig.addPlugin( tableOfContents )

    
  return {
    markdownTemplateEngine: "njk",
    jsDataFileSuffix: ".data",
    dir: {
      layouts: "_includes/layouts"
    },
  }
}
