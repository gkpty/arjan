//function that reads a cloudfomration template and deploys it
var AWS = require('aws-sdk');
var cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15'});
var {stackExists, hostedZoneExists} = require('./checkResource');
var acmCertificate = require('./acmCertificate');
var Route53 = new AWS.Route53({apiVersion: '2013-04-01'});

module.exports = function deployStack(domain, template, existingResources, https, route53){
  let stackName = domain.replace(/./g, '') + 'Stack'
  let hostedZone = hostedZoneExists(domain)
  console.log('EXISTING RESOURCES: ', existingResources)
  createChangeSet(stackName, template, existingResources, false, function(err, data){
    if(err) throw new Error(err)
    else {
      var params = {ChangeSetName: data, StackName: stackName};
      cloudformation.waitFor('changeSetCreateComplete', params, function(err, data) {
        if(err) console.log(err)
        else {
          //console.log(data)
          executeChangeSet(stackName, data.ChangeSetName, (err,data) => {
            if(err) throw new Error(err)
            else {
              console.log('EXECUTED THE CHANGESET')
              /* 
              let params = {StackName: stackName}
              cloudformation.waitFor('stackCreateComplete', params, function(err, data) {
                if (err) console.log(err, err.stack);
                else { */
                //if(hostedZone) newHostedZone(domain, stackName, route53)
                if(https){
                  console.log('TRYING TO CREATE CERTIFICATE')
                  console.log(domain)
                  createCertificate(domain, stackName, route53, function(err,data){
                    if(err) throw new Error(err)
                    else {
                      console.log('DONE CREATING CERT')
                      let resource = {
                        'LogicalResourceId': 'Certificate',
                        'ResourceIdentifier': {
                          '<ResourceIdentifierPropertyKey>': data,
                        },
                        'ResourceType': 'AWS::CertificateManager::Certificate'
                      }
                      existingResources.push(resource)
                      importResources(domain, stackName, template, existingResources, callback)
                    }
                  })
                }
                else {
                  //not sure if necessary
                  importResources(domain, stackName, template, existingResources, callback)
                }
            /*  }
              }); */
            }
          })
        }
      });
    }
  })
}

function createCertificate(domain, stackName, route53, callback){
  console.log('CREATING CERTIFICATE')
  acmCertificate.requestCertificate(domain)
  .then((arn) => {
    console.log('ARN ', arn)
    const Arn = arn;
    acmCertificate.describeCertificate(arn)
    .then((data) => {
      console.log('DATOS', data)
      if(route53) {
        console.log('BOUT TO VALIDATE')
        acmCertificate.validateCertificate(data.cName, data.cValue, stackName)
        .then((data) =>{
          console.log(data)
          callback(null, Arn)
        })
        .catch((err)=>{throw new Error(err)})  
      }
      else{
        let msg = 
        `
        please create a CNAME record for the certficate in your domains DNS with the following vallues:\n
        name or host: ${data.cName}\n
        value or points to: ${data.cValue}\n
        `
        console.log(msg)
        callback(null, arn)
      }
    }).catch((err)=>{throw new Error(err)})
  }).catch((err)=>{throw new Error(err)})
}

function importResources(domain, stackName, template, existingResources, https, callback){
  if(existingResources && existingResources.length > 0) {
    //add digital certificate to template
    if(https) {
      let Certificate = {
        "Type": "AWS::CertificateManager::Certificate",
        "Properties": {
          "DomainName" : domain,
          "DomainValidationOptions" : [ 
            {
              "DomainName": domain,
              "ValidationDomain": domain
            } 
          ],
          "SubjectAlternativeNames" : [ `*.${domain}` ],
          "ValidationMethod" : "DNS"
        }
      }
      template.Resources["Certificate"] = Certificate;
      template.Resources.CloudFrontDistribution.Properties.DistributionConfig["ViewerCertificate"] = {
        "AcmCertificateArn" : {"Ref": "Certificate"},
        "MinimumProtocolVersion" : "TLSv1.1_2016",
        "SslSupportMethod" : "sni-only"
      }
      template.Resources.CloudFrontDistribution.Properties.DistributionConfig["Aliases"] = [
        RootBucketRef,
        `www.${RootBucketRef}`
      ]
    }
    createChangeSet(stackName, template, existingResources, true, function(err, data){
      if(err) throw new Error(err)
      else {
        var params = {ChangeSetName: data, StackName: stackName};
        cloudformation.waitFor('changeSetCreateComplete', params, function(err, data) {
          if(err) console.log(err)
          else {
            //console.log(data)
            executeChangeSet(stackName, data.ChangeSetName, (err,data) => {
              if(err) throw new Error(err)
              else {
                let params = {StackName: stackName} 
                cloudformation.waitFor('stackCreateComplete', params, function(err, data) {
                  if(err) console.log(err)
                  else callback(null, 'success with imports')
                })
              }
            })
          }
        })
      }
    })
  }
  else {
    //must choose between create or update or import
    let params = {StackName: stackName}
    cloudformation.waitFor('stackCreateComplete', params, function(err, data) {
      if(err) console.log(err)
      else callback(null, 'success no import')
    })
  }
}


function newHostedZone(domain, stackName, route53){
  if(route53){
    var params = {
      LogicalResourceId: 'HostedZone',
      StackName: stackName
    };
    cloudformation.describeStackResource(params, function(err, data) {
      if (err) throw new Error(err.stack)
      else {
        console.log('HOSTEDZONE DATA', data)
        var params = {Id: data.StackResourceDetail.PhysicalResourceId}
        Route53.waitFor('resourceRecordSetsChanged', params, function(err, data) {
          if (err) console.log(err, err.stack);
          else {
            Route53.getHostedZone(params, function(err, data) {
              if (err) console.log(err, err.stack);
              else {
                let msg = 'In your Domain name registrar, please change your DNS settings to custom DNS and add the following Nameservers: \n' +  data.DelegationSet.NameServers;
                console.log(msg)
              }
            });
          }
        });
      }
    });
  }
  else {
    let msg = 'please create a CNAME record pointing to your distribution from the root. if you have mx records for your root domain this will interfere. please check out the docs for alternatives.'
    console.log(msg)
  }
}

function executeChangeSet(stackName, changeSetName, callback){
  var params = {
    ChangeSetName: changeSetName, /* required */
    StackName: stackName
  };
  cloudformation.executeChangeSet(params, function(err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    else {
      callback(null, data)
    }
  });
}

function createChangeSet(stackName, template, existingResources, importAction, callback){
  let dateobj = new Date();
  let dateString = dateobj.toString()
  let changeSetName = stackName + dateString.split("GMT")[0].split(' ').join('').replace(/:/g,'')
  stackExists(stackName).then((data) =>{
    //console.log('DATAaaaaaaaaaa', data)
    let action = data ? 'UPDATE': 'CREATE';
    if(importAction) action = 'IMPORT';
    var params = {
      ChangeSetName: changeSetName,
      StackName: stackName,
      Capabilities: [
        'CAPABILITY_NAMED_IAM'
      ],
      ChangeSetType: action,
      TemplateBody: JSON.stringify(template)
      //Description: 'STRING_VALUE',
      /* 
      ResourceTypes: [
        'STRING_VALUE',
      ], 
      */ 
      //RoleARN: 'STRING_VALUE',
    };
    if(importAction) params["ResourcesToImport"] = existingResources;
    params["TemplateBody"] = template;
    //console.log(params)
    cloudformation.createChangeSet(params, function(err, data) {
      if (err) throw new Error(err.stack);
      else callback(null, changeSetName)
    })
  })
}