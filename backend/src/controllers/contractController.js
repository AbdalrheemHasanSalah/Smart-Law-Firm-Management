import {
  createContractReadStream,
  getContract,
  getContractDownload,
  listContracts,
  updateContract,
  uploadContract,
} from '../services/contractService.js';

export async function listContractsController(request, response, next) {
  try {
    return response.status(200).json(await listContracts(request.user, request.query));
  } catch (error) {
    return next(error);
  }
}

export async function getContractController(request, response, next) {
  try {
    return response.status(200).json({
      contract: await getContract(request.user, request.params.contractId),
    });
  } catch (error) {
    return next(error);
  }
}

export async function uploadContractController(request, response, next) {
  try {
    return response.status(201).json({
      contract: await uploadContract(
        request.user,
        request.params.clientId,
        request
      ),
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateContractController(request, response, next) {
  try {
    return response.status(200).json({
      contract: await updateContract(
        request.user,
        request.params.contractId,
        request.body
      ),
    });
  } catch (error) {
    return next(error);
  }
}

export async function downloadContractController(request, response, next) {
  try {
    const { contract, fileHandle, fileSize } = await getContractDownload(
      request.user,
      request.params.contractId
    );
    return streamContractDownload(response, next, fileHandle, fileSize, contract.contract_id);
  } catch (error) {
    return next(error);
  }
}

export function streamContractDownload(
  response,
  next,
  fileHandle,
  fileSize,
  contractId
) {
  response.status(200).set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(fileSize),
    'Content-Disposition': `attachment; filename="contract-${contractId}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let stream;
  let fileHandleClosed = false;
  const closeFileHandle = () => {
    if (fileHandleClosed) return;
    fileHandleClosed = true;
    fileHandle.close().catch(() => {});
  };
  try {
    stream = createContractReadStream(fileHandle);
  } catch (error) {
    closeFileHandle();
    throw error;
  }
  stream.once('close', closeFileHandle);
  stream.once('end', closeFileHandle);
  stream.on('error', () => {
    closeFileHandle();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    next(new Error('Unable to retrieve contract file.'));
  });
  response.once('close', () => {
    if (!stream.closed) stream.destroy();
    closeFileHandle();
  });
  response.once('finish', closeFileHandle);
  stream.pipe(response);
  return undefined;
}
