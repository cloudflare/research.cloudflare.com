/*
let blogposts = [
  {
    date: '2021-05-13',
    link: 'https://blog.cloudflare.com/introducing-cryptographic-attestation-of-personhood/',
    image: 'https://blog.cloudflare.com/content/images/2021/04/image2-36.png',
    heading: 'Ending CAPTCHAs with the Cryptographic Attestation of Personhood',
    text: 'A real human should be able to touch or look at their device to prove they are human, without revealing their identity'
  },
  {
    date: '2021-01-13',
    link: 'https://blog.cloudflare.com/cloudflare-distributed-web-resolver/',
    image: 'https://blog.cloudflare.com/content/images/2021/01/image4-2.png',
    heading: 'A Name Resolver for the Distributed Web',
    text: 'Announcing a new resolver for the Distributed Web, where IPFS content indexed by the Ethereum Name Service (ENS) can be accessed'
  },
  {
    date: '2020-08-12',
    link: 'https://blog.cloudflare.com/oblivious-dns/',
    image: 'https://blog.cloudflare.com/content/images/2020/12/image2-4.png',
    heading: 'Improving DNS Privacy with Oblivious DoH in 1.1.1.1',
    text: 'We support a new proposed DNS standard — co-authored by engineers from Cloudflare, Apple, and Fastly — that separates IP addresses from queries, so that no single entity can see both at the same time'
  }
]
*/

//console.log( blogposts )


let Parser = require( 'node-xml-stream' )
const https = require( 'https' )
const fs = require( 'fs' )
const path = require( 'path' )
const stream = require( 'stream' )
const util = require( 'util' )

const { execSync } = require("child_process");

const yaml = require( 'js-yaml' )

const finished = util.promisify( stream.finished )



async function parseRSS( filename ) {

  let blogposts = []
  let blogpost = {}
  let attribute = ''

  let parser = new Parser()
  console.log( "parsing '" + filename + "'" )

  parser.on( 'opentag', ( name, attrs ) => {
    if ( name == 'item' ) {
      blogpost = { category: [] }
    }
    else {
      switch ( name ) {
        case 'title':
          attribute = 'heading'; break
        case 'description':
        	attribute = 'text'; break
        case 'pubDate':
          attribute = 'date'; break
        case 'media:content':
          blogpost.image = attrs[ 'url' ]; break
        case 'category':
        case 'link':
          attribute = name
          break
        default:
          attribute = ''
      }
    }

  } );


  parser.on( 'closetag', name => {
    if ( name == 'item' ) {
      blogposts.push( blogpost )
    }
  } );

  parser.on( 'text', text => {
    if ( attribute == 'link' ) {
    	blogpost[ attribute ] = text
    }
    else if ( attribute == 'date' ) {
      blogpost[ attribute ] = new Date( text ).toISOString()
    }
  } );

  parser.on( 'cdata', cdata => {
    if ( attribute == 'category' ) {
    	blogpost[ attribute ].push( cdata )
    }
    else if ( [ 'heading', 'text' ].includes( attribute ) ) {
      blogpost[ attribute ] = cdata
    }
  } );

  let fstream = fs.createReadStream( filename )
  fstream.pipe( parser )

  let done = await finished( fstream )

  return blogposts
}


function downloadIfNotFound( url, destination ) {
  if ( ! fs.existsSync( destination ) ) {
    console.log( "downloading url '" + url + "' to '" + destination + "'" )
    execSync( "curl '" + url + "' -o " + destination )
  }
}


let result = {}

async function main() {


  // process feeds per person
  const files = fs.readdirSync( 'people/' );

  let content = ''
  for ( const file of files ) {

    if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' ) {
      content = fs.readFileSync( 'people/' + file, 'utf8' )
      let slug = path.parse( file ).name
      let front = content.substr( 4, content.indexOf( '---', 4 ) - 4 )
      frontMatter = yaml.load( front );
      if ( frontMatter.position ) {
        let blog_author = frontMatter.blog_author
        if ( blog_author == undefined )
          blog_author = slug

        downloadIfNotFound( 'https://blog.cloudflare.com/author/' + blog_author + '/rss/', slug + '.rss' )

        let person_posts = await parseRSS( slug + '.rss' )

        if ( person_posts.length > 0 )
          result[ slug ] = person_posts
      }
    }
  }

  // process feed for the tag 'research'
  downloadIfNotFound( 'https://blog.cloudflare.com/tag/research/rss/', 'rss.xml' )
  let ordered_posts = await parseRSS( 'rss.xml' )
  result.ordered = ordered_posts

}



module.exports = async function() {
  let done = await main().catch( console.log )

  //console.log( result )

  return result
}

