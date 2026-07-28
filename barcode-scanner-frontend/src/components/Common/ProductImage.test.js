import React from 'react';
import {render, fireEvent, screen} from '@testing-library/react';
import ProductImage from './ProductImage';

describe('ProductImage', () => {
  it('renders an img with the given src and alt', () => {
    render(<ProductImage src="http://img.test/p1" alt="Pan"/>);
    const img = screen.getByRole('img', {name: 'Pan'});
    expect(img).toHaveAttribute('src', 'http://img.test/p1');
  });

  it('renders nothing after the image fails to load', () => {
    render(<ProductImage src="http://img.test/broken" alt="Pan"/>);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the image again when src changes after a failure', () => {
    const {rerender} = render(<ProductImage src="http://img.test/broken" alt="Pan"/>);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<ProductImage src="http://img.test/ok" alt="Pot"/>);
    const img = screen.getByRole('img', {name: 'Pot'});
    expect(img).toHaveAttribute('src', 'http://img.test/ok');
  });

  it('passes through className and style', () => {
    render(
      <ProductImage src="http://img.test/p1" alt="Pan" className="m-product-hero-img"
                    style={{width: 36}}/>
    );
    const img = screen.getByRole('img');
    expect(img).toHaveClass('m-product-hero-img');
    expect(img).toHaveStyle({width: '36px'});
  });
});
