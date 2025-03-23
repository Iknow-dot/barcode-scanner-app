import React, {createContext, useState} from "react";

export const SubNavContext = createContext([]);

export const SubNavProvider = ({children}) => {
  const [subNav, setSubNav] = useState([]);

  return (
      <SubNavContext.Provider value={{subNav, setSubNav}}>
        {children}
      </SubNavContext.Provider>
  );
};

export default SubNavContext;
