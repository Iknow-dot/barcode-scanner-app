import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import GiftToggleButton from './GiftToggleButton';

describe('GiftToggleButton', () => {
  it('renders nothing when the org has gifts disabled', () => {
    const {container} = render(
      <GiftToggleButton enabled={false} isGift={false} onToggle={() => {}} label="Gift"/>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('fires onToggle when clicked', () => {
    const onToggle = jest.fn();
    render(<GiftToggleButton enabled isGift={false} onToggle={onToggle} label="Gift"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Gift'}));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('highlights when the line is already a gift', () => {
    render(<GiftToggleButton enabled isGift onToggle={() => {}} label="Gift"/>);
    expect(screen.getByRole('button', {name: 'Gift'})).toHaveStyle({color: '#eb2f96'});
  });
});
