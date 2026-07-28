import React, {useState, useEffect} from 'react';

// Product photos are served through the backend image proxy, which can fail
// even when the catalog row lists image URLs (missing file in 1C, upstream
// down). A bare <img> then renders the browser's broken-image box, so once
// loading fails we drop the element entirely — same treatment as a product
// with no photos at all (ClickUp 86cav889c).
const ProductImage = ({src, alt, className, style}) => {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (!src || failed) return null;
    return (
        <img src={src} alt={alt} className={className} style={style}
             onError={() => setFailed(true)}/>
    );
};

export default ProductImage;
