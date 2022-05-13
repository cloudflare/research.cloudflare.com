const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function generateNavigationFromDirectories() {
  let navigation = []; 

  const base_path = 'projects/'
  
  try {
    console.log( process.cwd() )
    const dirents = fs.readdirSync( './' + base_path, { withFileTypes: true } )
    //console.log( dirents )
        
    let content = ''
    for ( const dirent of dirents ) {
            
      if ( dirent.isDirectory() ) {

        let directory = dirent.name
        //console.log( directory)
        
        content = fs.readFileSync( base_path + directory + '/index.njk', 'utf8' )
        
        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )
        
        frontMatter = yaml.load( front );
        
        navigation.push( { path: '/' + base_path + directory + '/', label: frontMatter.title } )
      }
    }

  }
  catch (err) {
    console.error(err);
  }
  
  return navigation;
}

let navigation = generateNavigationFromDirectories();
//console.log( navigation );

module.exports = {
  layout: 'project',
  navigation: navigation,
}


/*

  projects.navigation
    [ 
      { 
        path:
        label:
      },
      ...
    ]
  
*/
