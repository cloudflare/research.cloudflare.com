const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function generatePublications() {

  let publications = [];
  
  try {
    const files = fs.readdirSync( 'publications/' );
        
    let content = ''
    for ( const file of files ) {
      
      //console.log( file )
      //console.log( path.parse( file ) )
      
      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' ) {
        let slug = path.parse( file ).name
        content = fs.readFileSync( 'publications/' + file, 'utf8' )
        
        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )
        
        frontMatter = yaml.load( front );
        //console.log( frontMatter )
        frontMatter.slug = slug
        
        publications.push( frontMatter )
      }
    }
     
  }
  catch (err) {
    console.error(err);
  }
  
  return publications;
}
// parse the front matter and add to 'profiles'
let publications = generatePublications();
//console.log( publications );

// sort without year first and then newest to oldest years
let ordered = publications.sort( ( a, b ) => { 
  if ( typeof( a.year ) == 'number' && typeof( b.year ) == 'number' )
    return b.year - a.year
  else if ( a.year == null && b.year == null )
    return 0
  else if ( a.year == null )
    return -1
  else if ( b.year == null )
    return 1
} )


let author_publications = {}
for ( const publication of ordered ) {
  for ( const author of publication.authors ) {
    //console.log( author )
    if ( author_publications[ author ] === undefined ) author_publications[ author ] = []
    author_publications[ author ].push( publication.slug )
  }
}



module.exports = {
  'ordered': ordered
}

for ( publication of publications ) {
  module.exports[ publication.slug ] = publication
}

for ( author in author_publications ) {
  module.exports[ author ] = author_publications[ author ]
}

//console.log( module.exports )

/*

  publicatioins.ordered
    [ ... publications ordered by year (most recent first) ... ]
  
  publications[ 'McMillion2016' ]
    { ... frontmatter from publications/McMillion2016.md ... }

  publications[ 'cefan-rubin' ] 
    { ... ordered list of publications where cefan-rubin is listed as an author (most recent first) ... }


*/
