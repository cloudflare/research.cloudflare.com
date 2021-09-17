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
const fs = require( 'fs' )
const stream = require( 'stream' )
const util = require( 'util' )

const finished = util.promisify( stream.finished )

let parser = new Parser()

let blogposts = []
let blogpost = {}
let attribute = ''

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



let fstream = fs.createReadStream( 'rss.xml' )
fstream.pipe( parser )


module.exports = async function() {
  let done = await finished( fstream )

  //console.log( blogposts )
  return blogposts
}

