import * as React from "react";
import * as ReactDOM from "react-dom/client";
import * as ReactDOMLegacy from "react-dom";
window.React = React;
window.ReactDOM = { ...ReactDOMLegacy, ...ReactDOM };
