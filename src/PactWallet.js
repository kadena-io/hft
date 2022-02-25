import React, { useState, useEffect, createContext, useContext, useCallback, useReducer } from "react";
import createPersistedState from 'use-persisted-state';
import _ from 'lodash';

import {
  Button,
  ButtonGroup,
  Box,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Checkbox,
  Container,
  ClickAwayListener,
  Collapse,
  Divider,
  Grid,
  Grow,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Modal,
  Dialog,
  AppBar,
  Toolbar,
  Slide,
} from '@material-ui/core';
import CloseIcon from '@material-ui/icons/Close';

import {
  makeStyles,
} from '@material-ui/styles';
import Autocomplete, { createFilterOptions } from '@material-ui/lab/Autocomplete';
import GavelIcon from '@material-ui/icons/Gavel';
import ExpandLess from '@material-ui/icons/ExpandLess';
import ExpandMore from '@material-ui/icons/ExpandMore';
//pact-lang-api for blockchain calls
import Pact from "pact-lang-api";
import {SigData} from './Pact.SigBuilder';
//config file for blockchain calls
import { PactTxStatus, signNewPactTx } from "./PactTxStatus.js";
import {
  PactJsonListAsTable,
  PactSingleJsonAsTable,
  MakeInputField,
  updateParams,
  renderPactValue,
 } from "./util.js";
import { chainId, keyFormatter } from "./kadena-config.js";

const useStyles = makeStyles(() => ({
  formControl: {
    margin: "5px auto",
    minWidth: 120,
  },
  selectEmpty: {
    marginTop: "10px auto",
  },
  inline: {
    display: "inline",
  },
}));

const pactWalletContextDefault = {
  current: {},
  otherWallets: {},
  allKeys: [],
  globalConfig: {},
  contractConfigs: {},
  pastPactTxs: [],
};

export const PactWalletContext = createContext();

const pactWalletReducer = (state, action) => {
  switch (action.type) {
    case 'updateWallet':
      if (! _.has(action, "newWallet")) {throw new Error("updateWallet requires newWallet:{walletName,gasPrice,networkId,signingKey} key")};
      const prevWallet = _.cloneDeep(state.current);
      const otherWallets = _.cloneDeep(state.otherWallets);
      if (prevWallet.walletName) {
        // stops a bug on initial load where "undefined" is added as a wallet
        otherWallets[prevWallet.walletName] = prevWallet;}
      if (action.newWallet.walletName) {
        otherWallets[action.newWallet.walletName] = action.newWallet;
      } else {
        throw new Error("updateWallet requires newWallet:{walletName,gasPrice,networkId,signingKey} key")};
      const allKeys1 = _.filter(_.uniq(_.concat(_.cloneDeep(state.allKeys),action.newWallet.signingKey)),v=>v?true:false);
      return {...state, current: action.newWallet, otherWallets: otherWallets, allKeys: allKeys1};
    case 'addKeys':
      if (! _.has(action, "newKeys")) {throw new Error("addKeys requires newKeys:[] key")};
      const allKeys2 = _.filter(_.uniq(_.concat(_.cloneDeep(state.allKeys), action.newKeys)),v=>v?true:false);
      return {...state, allKeys: allKeys2};
    case 'setContractConfig':
      if (! _.has(action, "configName")) {throw new Error("addConfig requires configName:'' key")};
      if (! _.has(action, "config")) {throw new Error("addConfig requires config:'' key")};
      const configs = _.cloneDeep(state.contractConfigs);
      configs[action.configName] = action.config;
      return {...state, contractConfigs:configs};
    case 'setGlobalConfig':
      if (! _.has(action, "globalConfig")) {throw new Error("addConfig requires globalConfig:<object> key")};
      return {...state, globalConfig:action.globalConfig};
    case 'tractPactTx':
      if (! _.has(action, "newTx")) {throw new Error("trackPactTx requires newTx:'' key")};
      const newPactTxs = _.concat(_.cloneDeep(state.pastPactTxs),action.newTx);
      return {...state, pastPactTxs: newPactTxs};
    default:
      throw new Error(JSON.stringify(action));
  }
}

export const PactWallet = ({globalConfig, contractConfigs, children}) => {
  //PactWallet State
  const usePersistedWallet = createPersistedState("pactWallet7");
  const [persistedPactWallet,setPersistedPactWallet] = usePersistedWallet({});
  const [wallet,walletDispatch] = useReducer(pactWalletReducer, _.size(persistedPactWallet) ? _.cloneDeep(persistedPactWallet) : pactWalletContextDefault);
  // Experimental wrapper for "emit" bug found in https://github.com/donavon/use-persisted-state/issues/56
  useEffect(()=>{
    if (_.size(wallet) && ! _.isEqual(pactWalletContextDefault, wallet)) {
      console.debug("PactWallet.useEffect[persistedPactWallet,walletProvider,setPersistedPactWallet]", persistedPactWallet, " =to=> ", wallet);
      setPersistedPactWallet(wallet);}}
  ,[persistedPactWallet,wallet,setPersistedPactWallet]);

  useEffect(()=>{
    console.debug("PactWallet.useEffect[] fired, contratConfigs added: ", _.keys(contractConfigs));
    _.mapKeys(contractConfigs,(k)=>walletDispatch({type:"setContractConfig", configName:k, config:contractConfigs[k]}))
    walletDispatch({type:"setGlobalConfig", globalConfig})
  }
  ,[])

  return <PactWalletContext.Provider value={{wallet,walletDispatch}}>
          {children}
         </PactWalletContext.Provider>
}

export const usePactWallet = () => {
  // grab the entire wallet state, with no reducer
  const {wallet} = useContext(PactWalletContext);
  return wallet;
};

export const usePactWalletContext = () => useContext(PactWalletContext);

export const useContractConfig = (configName) => {
  // get a specific contract config
  const {wallet: {contractConfigs}} = useContext(PactWalletContext);
  if (! _.has(contractConfigs, configName))
    {throw new Error(`usePactConfig attempted to get ${configName} but it was not present in ${JSON.stringify(contractConfigs)}`)};
  return contractConfigs[configName];
};

export const walletDrawerEntries = {
  primary:"Wallet",
  subList:
    [{
      primary:"Config",
      to:{app:"wallet", ui: "config"}
    }
  ]
};

export const WalletApp = ({
  appRoute,
  setAppRoute,
}) => {

  return (
    appRoute.ui === "config" ?
    <Card>
      <CardHeader title="Wallet Configuration"/>
      <CardContent>
        <WalletConfig/>
        <CurrentWallet/>
        <OtherWallets/>
      </CardContent>
    </Card>
  : <React.Fragment>
      {setAppRoute({app:"wallet", ui:"config"})}
  </React.Fragment>
  )
};

const filter = createFilterOptions();

const EntrySelector = ({
  label,
  getVal,
  setVal,
  allOpts
}) => {
  const classes = useStyles();
  let localOptions = allOpts ? _.cloneDeep(allOpts) : [""];

  return (
    <Autocomplete
      className={classes.formControl}
      value={getVal}
      onChange={(event, newValue) => {
        if (typeof newValue === 'string') {
          setVal(newValue);
        } else if (newValue && newValue.inputValue) {
          // Create a new value from the user input
          setVal(newValue.inputValue)
        } else {
          setVal(newValue);
        }
      }}
      filterOptions={(options, params) => {
        const filtered = filter(options, params);

        // Suggest the creation of a new value
        if (params.inputValue !== '') {
          filtered.push({
            inputValue: params.inputValue,
            title: `Add "${params.inputValue}"`,
          });
        }

        return filtered;
      }}
      selectOnFocus
      fullWidth
      clearOnBlur
      handleHomeEndKeys
      defaultValue={getVal ? getVal : null}
      options={localOptions}
      getOptionLabel={(option) => {
        // Value selected with enter, right from the input
        // Add "xxx" option created dynamically
        if (option.inputValue) {
          return option.inputValue;
        } else {
          // Regular option
          return option;
        }
      }}
      renderOption={(option) => option.title ? option.title : option}
      freeSolo
      renderInput={(params) => (
        <TextField {...params} label={label} variant="outlined" fullWidth className={classes.formControl} />
      )}
    />
  );
}


export const KeySelector = ({
  label,
  getVal,
  setVal,
  allOpts
}) => {
  const classes = useStyles();
  let localOptions = allOpts ? _.cloneDeep(allOpts) : [""];

  return (
    <Autocomplete
      multiple
      limitTags={3}
      className={classes.formControl}
      value={getVal}
      onChange={(event, newValue) => {
        if (typeof newValue === 'string') {
          setVal(newValue);
        } else if (newValue && newValue.inputValue) {
          // Create a new value from the user input
          setVal(newValue.inputValue)
        } else {
          setVal(newValue);
        }
      }}
      filterOptions={(options, params) => {
        const filtered = filter(options, params);

        // Suggest the creation of a new value
        if (params.inputValue !== '') {
          filtered.push({
            inputValue: params.inputValue,
            title: `Add "${params.inputValue}"`,
          });
        }

        return filtered;
      }}
      selectOnFocus
      fullWidth
      clearOnBlur
      handleHomeEndKeys
      defaultValue={getVal ? getVal : null}
      options={localOptions}
      getOptionLabel={(option) => {
        // Value selected with enter, right from the input
        // Add "xxx" option created dynamically
        if (option.inputValue) {
          return option.inputValue;
        } else {
          // Regular option
          return option;
        }
      }}
      renderOption={(option) => option.title ? option.title : option}
      freeSolo
      renderInput={(params) => (
        <TextField {...params} label={label} variant="outlined" fullWidth className={classes.formControl} />
      )}
    />
  );
}


export const CurrentWallet = () => {
  const {current} = usePactWallet();

  return <Container style={{"paddingTop":"2em"}}>
    <Typography component="h2">Active Wallet</Typography>
    <PactSingleJsonAsTable
      json={current}
      keyFormatter={keyFormatter}
      />
  </Container>
};

export const OtherWallets = () => {
  const {otherWallets} = usePactWallet();

  return <Container style={{"paddingTop":"2em"}}>
    <Typography component="h2">All Saved PactWallets</Typography>
    <PactSingleJsonAsTable
      json={otherWallets}
      keyFormatter={keyFormatter}
      />
  </Container>
};

export const WalletConfig = () => {
  const {wallet, walletDispatch} = useContext(PactWalletContext);
  const [saved,setSaved] = useState(false);
  const [walletName,setWalletName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [signingKey, setSigningKey] = useState("");
  const [networkId, setNetworkId] = useState("testnet04");
  const [gasPrice, setGasPrice] = useState("0.000001");
  const [gasLimit, setGasLimit] = useState("10000");
  const classes = useStyles();

  const [txStatus, setTxStatus] = useState("");
  const [tx, setTx] = useState({});
  const [txRes, setTxRes] = useState({});
  const [host, setHost] = useState("");
  const pactTxStatus = {
    tx:tx,setTx:setTx,
    txStatus:txStatus,setTxStatus:setTxStatus,
    txRes:txRes,setTxRes:setTxRes,
  };

  const [wasSubmitted,setWasSubmitted] = useState(false);

  useEffect(()=> {
    console.debug("WalletConfig useEffect on load fired with", wallet)
    if (_.size(wallet.current)) {
        if (wallet.current.walletName) {setWalletName(wallet.current.walletName)}
        if (wallet.current.signingKey) {setSigningKey(wallet.current.signingKey)}
        if (wallet.current.accountName) {setAccountName(wallet.current.accountName)}
        if (wallet.current.gasPrice) {setGasPrice(wallet.current.gasPrice)}
        if (wallet.current.gasLimit) {setGasLimit(wallet.current.gasLimit)}
        if (wallet.current.networkId) {setNetworkId(wallet.current.networkId)}
    }
  }
  ,[]);

  useEffect(()=>{
    if (_.size(wallet.otherWallets[walletName])) {
      const loadingWallet = wallet.otherWallets[walletName];
      console.debug("PactWalletConfig updating entries", loadingWallet)
        if (loadingWallet.walletName && loadingWallet.signingKey &&
            loadingWallet.gasPrice && loadingWallet.gasLimit &&
            loadingWallet.networkId && loadingWallet.accountName) {
          setGasPrice(loadingWallet.gasPrice);
          setGasLimit(loadingWallet.gasLimit);
          setSigningKey(loadingWallet.signingKey);
          setAccountName(loadingWallet.accountName);
          setNetworkId(loadingWallet.networkId);
          setWalletName(loadingWallet.walletName);
        }
    }
  },[walletName])

  useEffect(()=>{
    setSaved(false);
    setWasSubmitted(false);
  },[walletName,signingKey,gasPrice,gasLimit,networkId,accountName]);

  const handleSubmit = (evt) => {
      evt.preventDefault();
      if (saved) {
        setHost(hostFromNetworkId(networkId));
        SigData.debug.toggleDebug();
        const sigData = SigData.ex.execCmdExample1({
          chainId:chainId,
          user: accountName,
          signingPubKey: signingKey,
          networkId,
          gasPrice: Number.parseFloat(gasPrice),
          gasLimit: Number.parseFloat(gasLimit)
        });
        // SigData.ex.contCmdExample1({
        //   user: signingKey,
        //   signingPubKey: signingKey,
        //   networkId,
        //   gasPrice: Number.parseFloat(gasPrice),
        //   gasLimit: 10000
        // });
        signNewPactTx(sigData, pactTxStatus);
      } else {
        const n = {walletName:walletName, signingKey:signingKey,
          gasPrice:gasPrice, gasLimit:gasLimit,
          networkId:networkId, accountName:accountName};
        walletDispatch({type: 'updateWallet', newWallet: n});
        setSaved(true);
        console.debug("WalletConfig set. locale: ", n, " while context is: ", wallet.current);
      }
  };

  const inputFields = [
    {
      type:'textFieldSingle',
      label:'Gas Price',
      className:classes.formControl,
      value:gasPrice,
      onChange:setGasPrice,
    },{
      type:'textFieldSingle',
      label:'Gas Limit',
      className:classes.formControl,
      value:gasLimit,
      onChange:setGasLimit,
    }
  ];

  return <Container style={{"paddingTop":"1em"}}>
    <Typography component="h2">Add or Update Wallet</Typography>
      <form
        autoComplete="off"
        onSubmit={(evt) => handleSubmit(evt)}>
        <EntrySelector label="Wallet Name" getVal={walletName} setVal={setWalletName} allOpts={_.keys(wallet.otherWallets)}/>
        <EntrySelector label="Network ID" getVal={networkId} setVal={setNetworkId} allOpts={_.uniq(_.concat(_.map(wallet.otherWallets, 'networkId'), "mainnet01", "testnet04"))}/>
        {inputFields.map(f =>
          <MakeInputField inputField={f}/>
        )}
        <EntrySelector label="Account Name" getVal={accountName} setVal={setAccountName} allOpts={_.map(wallet.otherWallets, 'accountName')}/>
        <EntrySelector label="Select Signing Key" getVal={signingKey} setVal={setSigningKey} allOpts={wallet.allKeys}/>
        <CardActions>
          {saved ?
            (wasSubmitted ? <React.Fragment/>
            : <React.Fragment>
              <Button variant="outlined" color="default" type="submit">
                Test Current Settings
              </Button>
            </React.Fragment>)
          :
            <Button variant="outlined" color="default" type="submit">
              Save Current Settings
            </Button>
          }
        </CardActions>
      </form>
      { txStatus === 'pending' ? <LinearProgress /> : null }
      <PactTxStatus pactTxStatus={pactTxStatus} host={host}/>
  </Container>
};

export const hostFromNetworkId = (networkId) => {
  if (networkId === "testnet04") {
    return `https://api.testnet.chainweb.com/chainweb/0.0/${networkId}/chain/${chainId}/pact`;
  } else {
    return `https://api.chainweb.com/chainweb/0.0/${networkId}/chain/${chainId}/pact`
  }
};
