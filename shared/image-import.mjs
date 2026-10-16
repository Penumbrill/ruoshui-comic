export function importableImages(files){
 return Array.from(files||[]).filter(file=>file&&/\.(png|jpe?g|webp)$/i.test(file.name||'')&&(!file.type||/^image\/(png|jpeg|webp)$/i.test(file.type)));
}
