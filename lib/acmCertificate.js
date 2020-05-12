var AWS = require('aws-sdk');
var acm = new AWS.ACM({apiVersion: '2015-12-08'});
var cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15'});
var Route53 = new AWS.Route53({apiVersion: '2013-04-01'});


function requestCertificate(domain){
  return new Promise((resolve, reject) => {
    var params = {
      DomainName: domain, /* required */
      DomainValidationOptions: [
        {
          DomainName: domain,
          ValidationDomain: domain,
        },
      ],
      SubjectAlternativeNames: [
        `*.${domain}`,
      ],
      ValidationMethod: 'DNS'
    };
    acm.requestCertificate(params, function(err, data) {
      if (err) reject(err)
      else {
        console.log('CERTFICATE ARN DATA', data);
        console.log(data.CertificateArn);
        resolve(data.CertificateArn)  
      }
    });
  })
}


function getCertificateArn(stackName){
  return new Promise((resolve, reject) => {
    var params = {
      LogicalResourceId: 'Certificate',
      StackName: stackName
    };
    cloudformation.describeStackResource(params, function(err, data){
      if(err) reject(err)
      else {
        console.log('CERT ARN DATA\n', data);
        let certStatus = data.StackResourceDetail.ResourceStatus;
        let certArn = data.StackResourceDetail.PhysicalResourceId;
        console.log(certStatus, certArn)
        resolve(certArn)
        /* if(certStatus === 'CREATE_IN_PROGRESS'){
          var params = {CertificateArn: certArn};
          acm.waitFor('certificateValidated', params, function(err, data) {
            if (err) reject(err); 
            else {
              console.log(data);
              resolve(data)
            }          
          });
        }
        else {
          console.log(certArn)
          if(certArn) resolve(certArn)
          else reject('Error')
        } */
      }
    })
  })
}

function describeCertificate(certificateArn){
  console.log('DESCRIBING CERT')
  return new Promise((resolve, reject) => {
    var params = {CertificateArn: certificateArn};
    acm.describeCertificate(params, function(err, data) {
      if (err) {
        console.log('ERROR ', err)
        reject(err);
      }
      else {
        console.log('CERTDATA ', data)
        if(data.Certificate.DomainValidationOptions[0]){
          const cName = data.Certificate.DomainValidationOptions[0].ResourceRecord.Name;
          const cValue = data.Certificate.DomainValidationOptions[0].ResourceRecord.Value;
          console.log('CNAME   ', cName, cValue);
         resolve({"cname": cName, "cvalue": cValue});
        }
      }
    });
  })  
}

function validateCertificate(cName, cValue, stackName) {
  //console.log(cName);
  //console.log(cValue);
  //get the hostedZone id
  console.log('VALIDATING CERTIFICATE')
  return new Promise((resolve, reject) => {
    var params = {
      LogicalResourceId: 'HostedZone',
      StackName: stackName
    };
    cloudformation.describeStackResource(params, function(err, data) {
      if (err) reject(err);
      else {
        console.log('HOSTEDZONE RESOURCE DATA', data);
        //console.log(data.StackResourceDetail);
        //console.log(data.StackResourceDetail.PhysicalResourceId);
        //create a CNAME record for the certificate in your route53 DNS
        let hostedZone = data.StackResourceDetail.PhysicalResourceId;
        var params = {
          ChangeBatch: {
            Changes: [
              {
                Action: "CREATE", 
                ResourceRecordSet: {
                  Name: cName, 
                  ResourceRecords: [{Value: cValue}], 
                  TTL: 300, 
                  Type: "CNAME"
                }
              }
            ], 
            Comment: "create CNAME record for the AWS ACM certificate"
          }, 
          HostedZoneId: hostedZone
        };
        Route53.changeResourceRecordSets(params, function(err, data) {
          if (err) reject(err.stack)
          else resolve('record for certificate created');
        });
      }
    });
  })
}

module.exports = {
  requestCertificate,
  getCertificateArn,
  describeCertificate,
  validateCertificate
}