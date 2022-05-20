const { getFrontMatter, generateNavigationFromDirectories } = require( '../_data/functions.js' )

let { paths, lookup } = generateNavigationFromDirectories( 'projects/' )
//console.log( JSON.stringify( paths ) )
//console.log( JSON.stringify( lookup ) )


module.exports = {
  layout: 'project',
  navigation: paths,
  lookup: lookup
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

  projects.lookup
    [ '/projects/application-privacy/' ] = [
      { 
        path:
        label:
      },
      ...	
    ]
*/
