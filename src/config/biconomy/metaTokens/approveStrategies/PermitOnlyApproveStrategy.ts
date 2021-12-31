import { ethers } from 'ethers';
import { ApproveStrategy } from '../types';

export const permitDomainType = [
  { name: 'name', type: 'string' },
  //{ name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

export const eip2612PermitType = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

export class PermitOnlyApproveStrategy extends ApproveStrategy {
  async execute(spender: string, chainId: number) {
    const nonceMethod = this.contract.nonces;
    const nonce = parseInt(await nonceMethod(this.account));
    const deadline = Math.floor(Date.now() / 1000 + 3600);
    const name = await this.contract.name();

    const message = {
      nonce,
      owner: this.account,
      spender: spender,
      deadline: deadline.toString(),
      value: ethers.constants.MaxUint256.toString(),
    };

    const dataToSign = JSON.stringify({
      types: {
        EIP712Domain: permitDomainType,
        Permit: eip2612PermitType,
      },
      domain: {
        name,
        // version: '1', // TODO: Fetch version from config
        chainId: chainId.toString(), //or Number
        verifyingContract: this.token.address,
      },
      primaryType: 'Permit',
      message,
    });

    const signedData = await this.library.send('eth_signTypedData_v3', [
      this.account,
      dataToSign,
    ]);

    const { v, r, s } = ethers.utils.splitSignature(signedData);

    const response = await this.contract.permit(
      this.account,
      spender,
      message.value,
      deadline,
      v,
      r,
      s,
    );

    return response;
  }
}
