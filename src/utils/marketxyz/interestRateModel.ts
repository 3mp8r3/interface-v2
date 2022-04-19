import { MarketSDK } from 'market-sdk';
import { BN } from 'utils/bigUtils';
import { USDPricedPoolAsset } from './fetchPoolData';
import { abi as JumpRateModelABI } from '../../constants/abis/marketxyz/JumpRateModel.json';
import { BlocksPerMin } from '.';

export default class JumpRateModel {
  sdk: MarketSDK;
  asset: USDPricedPoolAsset;
  initialized = false;

  baseRatePerBlock?: BN;
  multiplierPerBlock?: BN;
  jumpMultiplierPerBlock?: BN;
  kink?: BN;

  reserveFactorMantissa?: BN;

  constructor(sdk: MarketSDK, asset: USDPricedPoolAsset) {
    this.sdk = sdk;
    this.asset = asset;
  }
  async init() {
    const jrmAddress = await this.asset.cToken.interestRateModel();
    const jrm = new this.sdk.web3.eth.Contract(
      JumpRateModelABI as any,
      jrmAddress,
    );

    this.baseRatePerBlock = this.sdk.web3.utils.toBN(
      await jrm.methods.baseRatePerBlock().call(),
    );
    this.multiplierPerBlock = this.sdk.web3.utils.toBN(
      await jrm.methods.multiplierPerBlock().call(),
    );
    this.jumpMultiplierPerBlock = this.sdk.web3.utils.toBN(
      await jrm.methods.jumpMultiplierPerBlock().call(),
    );
    this.kink = this.sdk.web3.utils.toBN(await jrm.methods.kink().call());

    this.reserveFactorMantissa = this.sdk.web3.utils.toBN(
      await this.asset.cToken.reserveFactorMantissa(),
    );
    this.reserveFactorMantissa.iadd(
      this.sdk.web3.utils.toBN(await this.asset.cToken.adminFeeMantissa()),
    );
    this.reserveFactorMantissa.iadd(
      this.sdk.web3.utils.toBN(await this.asset.cToken.fuseFeeMantissa()),
    );
    this.initialized = true;
  }

  getBorrowRate(utilizationRate: BN) {
    if (!this.initialized)
      throw new Error('Interest rate model class not initialized.');

    if (utilizationRate.lte(this.kink!)) {
      return utilizationRate
        .mul(this.multiplierPerBlock!)
        .div(this.sdk.web3.utils.toBN(1e18))
        .add(this.baseRatePerBlock!);
    } else {
      const normalRate = this.kink!.mul(this.multiplierPerBlock!)
        .div(this.sdk.web3.utils.toBN(1e18))
        .add(this.baseRatePerBlock!);
      const excessUtil = utilizationRate.sub(this.kink!);

      return excessUtil
        .mul(this.jumpMultiplierPerBlock!)
        .div(this.sdk.web3.utils.toBN(1e18))
        .add(normalRate);
    }
  }

  getSupplyRate(utilizationRate: BN) {
    if (!this.initialized)
      throw new Error('Interest rate model class not initialized.');

    const oneMinusReserveFactor = this.sdk.web3.utils
      .toBN(1e18)
      .sub(this.reserveFactorMantissa!);
    const borrowRate = this.getBorrowRate(utilizationRate);

    const rateToPool = borrowRate
      .mul(oneMinusReserveFactor)
      .div(this.sdk.web3.utils.toBN(1e18));

    return utilizationRate.mul(rateToPool).div(this.sdk.web3.utils.toBN(1e18));
  }

  convertIRMtoCurve() {
    const borrowerRates: { x: number; y: number }[] = [];
    const supplierRates: { x: number; y: number }[] = [];

    for (let i = 0; i <= 100; i++) {
      const supplyLevel =
        (Math.pow(
          (Number(
            this.getSupplyRate(
              this.sdk.web3.utils.toBN((i * 1e16).toString()),
            ).toString(),
          ) /
            1e18) *
            (BlocksPerMin * 60 * 24) +
            1,
          365,
        ) -
          1) *
        100;

      const borrowLevel =
        (Math.pow(
          (Number(
            this.getBorrowRate(
              this.sdk.web3.utils.toBN((i * 1e16).toString()),
            ).toString(),
          ) /
            1e18) *
            (BlocksPerMin * 60 * 24) +
            1,
          365,
        ) -
          1) *
        100;

      supplierRates.push({ x: i, y: supplyLevel });
      borrowerRates.push({ x: i, y: borrowLevel });
    }

    return { borrowerRates, supplierRates };
  }
}
