import React from 'react';
import ScanButton from './ScanButton';
import ProductDisplay from './ProductDisplay';

const Dashboard = () => {
  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <ScanButton />
      <ProductDisplay />
    </div>
  );
};

export default Dashboard;
