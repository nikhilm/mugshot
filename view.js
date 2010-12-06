function mark(faces) {
    for( var i = 0; i < faces.length; i++ ) {
        var face = faces[i];
        var div = $('<div class="face">');
        $('body').append(div);
        $(div).css({
            left: face.x,
            top: face.y,
            width: face.width,
            height: face.height
        });
    }
}
