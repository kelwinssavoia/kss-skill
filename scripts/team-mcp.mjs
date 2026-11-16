#!/usr/bin/env node
// Authenticated app-owned MCP gateway. Credentials stay in the process environment.
try{
 const {KSS_TEAM_MCP_PORT:port,KSS_TEAM_MCP_TOKEN:token,KSS_TEAM_CHANNEL:channelId}=process.env;
 if(!port||!token||!channelId)throw new Error('The KSS Team host is not connected. Use the harness native MCP tools.');
 const [name='list_mcp_tools',raw='{}']=process.argv.slice(2),args=JSON.parse(raw);
 if(!['list_mcp_tools','call_mcp_tool','present_team_artifact'].includes(name))throw new Error('Use list_mcp_tools, call_mcp_tool or present_team_artifact.');
 const response=await fetch('http://127.0.0.1:'+port+'/tool',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({channelId,name,arguments:args}),signal:AbortSignal.timeout(300000)}),value=await response.json();
 if(value.error)throw new Error(value.error);console.log(JSON.stringify(value.result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
