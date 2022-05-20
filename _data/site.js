const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function getFrontMatter( path ) {

  const content = fs.readFileSync( path, 'utf8' )
  const front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
  frontMatter = yaml.load( front )
  
  return frontMatter	
}


function generateNavigationFromDirectories( root, paths = [] ) {

  const dirents = fs.readdirSync( './' + root, { withFileTypes: true } )
      
  for ( const dirent of dirents ) {

    //console.log( dirent )

    // skip non-structural pages
    if ( dirent.name.includes( '.js' ) || dirent.name.includes( '.json' ) ) {
      continue
    }
          
    if ( dirent.isDirectory() ) {

      const directory = dirent.name
      frontMatter = getFrontMatter( root + directory + '/index.njk' )
      paths.push( { 
        path: '/' + root + directory, 
        label: frontMatter.title, 
        children: generateNavigationFromDirectories( root + directory + '/' )
      } )

    }  
    else {

      const file = dirent.name
      frontMatter = getFrontMatter( root + file )
      paths.push( {
        path: '/' + root + file, 
    	label: frontMatter.title,
        children: []
      } )

    }
  }
        
  return paths
}


module.exports = {
  copyright: new Date().getFullYear(),
  now: new Date().getTime(),
  getFrontMatter: getFrontMatter,
  generateNavigationFromDirectories
}
