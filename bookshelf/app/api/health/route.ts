import {bucket,database,serverError} from '../library/shared';
export const runtime='edge';
export async function GET(){try{await database().prepare('SELECT 1 AS ok').first();await bucket().list({limit:1});return Response.json({ok:true,version:'19'},{headers:{'Cache-Control':'no-store'}});}catch(error){return serverError(error);}}
