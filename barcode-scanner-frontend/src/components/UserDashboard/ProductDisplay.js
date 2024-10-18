import React from 'react';

const ProductDisplay = ({ product }) => {
  return (
    <div className="product-display">
      {product ? (
        <div>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
          <p>Price: {product.price}</p>
        </div>
      ) : (
        <p>No product data to display.</p>
      )}
    </div>
  );
};

export default ProductDisplay;
